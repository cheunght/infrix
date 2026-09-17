"""Django admin authentication with the same source routing and 2FA policy as the API."""

from __future__ import annotations

from django import forms
from django.contrib import admin
from django.contrib.auth import REDIRECT_FIELD_NAME, login as auth_login
from django.contrib.auth.models import User
from django.db import transaction
from django.http import HttpResponseRedirect
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.http import url_has_allowed_host_and_scheme
from django.utils.translation import gettext_lazy as _
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.debug import sensitive_post_parameters
from django.utils.decorators import method_decorator

from .auth_security import totp_step_for_code
from .auth_throttle import (
    clear_two_factor_throttle,
    register_two_factor_failure,
    trusted_client_ip,
    two_factor_lock_status,
)
from .configuration_secrets import ConfigurationSecretError, decrypt_secret
from .ldap_auth import (
    AUTH_SOURCE_LDAP,
    AUTH_SOURCE_LOCAL,
    LDAP_MODEL_BACKEND,
    AuthenticationFailure,
    authenticate_with_source_routing,
)
from .models import UserSecurityProfile


ADMIN_PENDING_USER_KEY = "infrix.admin_pending_2fa_user_id"
ADMIN_PENDING_SOURCE_KEY = "infrix.admin_pending_2fa_auth_source"
ADMIN_PENDING_NEXT_KEY = "infrix.admin_pending_2fa_next"
ADMIN_2FA_VERIFIED_USER_KEY = "infrix.admin_2fa_verified_user_id"


def _clear_admin_pending(request):
    for key in (ADMIN_PENDING_USER_KEY, ADMIN_PENDING_SOURCE_KEY, ADMIN_PENDING_NEXT_KEY):
        request.session.pop(key, None)


def _admin_redirect(request, site_name, candidate=None):
    target = candidate or request.POST.get(REDIRECT_FIELD_NAME) or request.GET.get(REDIRECT_FIELD_NAME)
    if target and url_has_allowed_host_and_scheme(
        target,
        allowed_hosts={request.get_host()},
        require_https=request.is_secure(),
    ):
        return target
    return reverse("admin:index", current_app=site_name)


class SecureAdminAuthenticationForm(forms.Form):
    username = forms.CharField(label=_("Username"), max_length=150)
    password = forms.CharField(label=_("Password"), strip=False, widget=forms.PasswordInput)

    def __init__(self, request=None, *args, **kwargs):
        self.request = request
        self.user_cache = None
        self.auth_source = None
        super().__init__(*args, **kwargs)

    def clean(self):
        cleaned = super().clean()
        username = str(cleaned.get("username", "")).strip()
        password = cleaned.get("password", "")
        if not username or not password:
            return cleaned
        try:
            result = authenticate_with_source_routing(self.request, username, password)
        except AuthenticationFailure as exc:
            if exc.infrastructure:
                raise forms.ValidationError(
                    _("Authentication service is temporarily unavailable."),
                    code="invalid_login",
                ) from exc
            raise forms.ValidationError(
                _("Please enter the correct username and password for a staff account."),
                code="invalid_login",
            ) from exc
        user = result.user
        if not user.is_active or not user.is_staff:
            raise forms.ValidationError(
                _("Please enter the correct username and password for a staff account."),
                code="invalid_login",
            )
        self.user_cache = user
        self.auth_source = result.auth_source
        return cleaned

    def get_user(self):
        return self.user_cache


class AdminTwoFactorForm(forms.Form):
    code = forms.CharField(
        label=_("Authentication code"),
        max_length=6,
        min_length=6,
        widget=forms.TextInput(attrs={"inputmode": "numeric", "autocomplete": "one-time-code", "autofocus": True}),
    )


class SecureAdminSite(admin.AdminSite):
    """AdminSite that requires TOTP for every staff account that enabled it."""

    site_header = "Infrix administration"
    site_title = "Infrix administration"
    index_title = "Infrix administration"

    def has_permission(self, request):
        user = getattr(request, "user", None)
        if not user or not user.is_active or not user.is_staff:
            return False
        enabled = UserSecurityProfile.objects.filter(user_id=user.pk).values_list(
            "two_factor_enabled", flat=True
        ).first()
        if enabled and str(request.session.get(ADMIN_2FA_VERIFIED_USER_KEY)) != str(user.pk):
            return False
        return True

    def get_urls(self):
        custom_urls = [
            path("login/2fa/", self.login_2fa, name="login_2fa"),
        ]
        return custom_urls + super().get_urls()

    @method_decorator(never_cache)
    @method_decorator(csrf_protect)
    @method_decorator(sensitive_post_parameters())
    def login(self, request, extra_context=None):
        if request.method == "GET" and self.has_permission(request):
            return HttpResponseRedirect(reverse("admin:index", current_app=self.name))

        from .views import (
            _clear_login_throttle,
            _login_lock_status,
            _register_login_failure,
        )

        form = SecureAdminAuthenticationForm(request, data=request.POST or None)
        username = str(request.POST.get("username", request.GET.get("username", ""))).strip()
        client_ip = trusted_client_ip(request)
        retry_after = 0
        locked = False
        if request.method == "POST" and username:
            locked, retry_after = _login_lock_status(username, client_ip)
            if locked:
                form.add_error(None, _("Too many failed attempts. Please try again later."))
        if request.method == "POST" and not locked and form.is_valid():
            user = form.get_user()
            _clear_login_throttle(username, client_ip)
            profile = UserSecurityProfile.objects.filter(user_id=user.pk).first()
            target = _admin_redirect(request, self.name)
            if profile and profile.two_factor_enabled:
                request.session[ADMIN_PENDING_USER_KEY] = user.pk
                request.session[ADMIN_PENDING_SOURCE_KEY] = form.auth_source or AUTH_SOURCE_LOCAL
                request.session[ADMIN_PENDING_NEXT_KEY] = target
                request.session.set_expiry(300)
                return HttpResponseRedirect(reverse("admin:login_2fa"))
            if form.auth_source == AUTH_SOURCE_LDAP:
                auth_login(request, user, backend=LDAP_MODEL_BACKEND)
            else:
                auth_login(request, user)
            request.session[ADMIN_2FA_VERIFIED_USER_KEY] = user.pk
            return HttpResponseRedirect(target)
        if request.method == "POST" and not locked and form.errors:
            actor = None
            if username:
                actor = User.objects.filter(username__iexact=username).first()
            if actor is not None or username:
                # Keep admin failures in the same account/IP throttle buckets
                # as API failures; the form still returns a generic message.
                _register_login_failure(
                    request,
                    username,
                    actor=actor,
                    reason="invalid_credentials",
                    auth_source=getattr(form, "auth_source", None),
                )

        context = {
            **self.each_context(request),
            "title": _("Log in"),
            "subtitle": None,
            "app_path": request.get_full_path(),
            "username": username,
            "form": form,
            REDIRECT_FIELD_NAME: _admin_redirect(request, self.name),
            "retry_after": retry_after,
        }
        context.update(extra_context or {})
        request.current_app = self.name
        return TemplateResponse(request, self.login_template or "admin/login.html", context)

    @method_decorator(never_cache)
    @method_decorator(csrf_protect)
    def login_2fa(self, request):
        pending_user_id = request.session.get(ADMIN_PENDING_USER_KEY)
        if not pending_user_id:
            return HttpResponseRedirect(reverse("admin:login"))
        user = User.objects.filter(pk=pending_user_id, is_active=True, is_staff=True).first()
        if user is None:
            _clear_admin_pending(request)
            return HttpResponseRedirect(reverse("admin:login"))

        form = AdminTwoFactorForm(request.POST or None)
        client_ip = trusted_client_ip(request)
        locked, retry_after = two_factor_lock_status(user.pk, client_ip)
        if request.method == "POST" and not locked:
            code = str(request.POST.get("code", "")).strip()
            profile = UserSecurityProfile.objects.filter(user_id=user.pk).first()
            step = None
            if profile and profile.two_factor_enabled and profile.two_factor_secret_encrypted:
                try:
                    secret = decrypt_secret(profile.two_factor_secret_encrypted)
                    step = totp_step_for_code(secret, code)
                except ConfigurationSecretError:
                    form.add_error(None, _("Two-factor authentication is unavailable."))
            if step is not None and profile and step != profile.two_factor_last_used_step:
                with transaction.atomic():
                    profile = UserSecurityProfile.objects.select_for_update().get(pk=profile.pk)
                    if step == profile.two_factor_last_used_step:
                        step = None
                    else:
                        profile.two_factor_last_used_step = step
                        profile.save(update_fields=["two_factor_last_used_step", "updated_at"])
                if step is not None:
                    clear_two_factor_throttle(user.pk, client_ip)
                    source = request.session.get(ADMIN_PENDING_SOURCE_KEY)
                    if source == AUTH_SOURCE_LDAP:
                        auth_login(request, user, backend=LDAP_MODEL_BACKEND)
                    else:
                        auth_login(request, user)
                    request.session[ADMIN_2FA_VERIFIED_USER_KEY] = user.pk
                    target = request.session.get(ADMIN_PENDING_NEXT_KEY) or reverse(
                        "admin:index", current_app=self.name
                    )
                    _clear_admin_pending(request)
                    return HttpResponseRedirect(target)

            if not form.errors:
                is_locked, retry_after = register_two_factor_failure(user.pk, client_ip)
                locked = is_locked
                form.add_error("code", _("The authentication code is invalid or expired."))
                if is_locked:
                    _clear_admin_pending(request)
                    form.add_error(None, _("Too many failed attempts. Please try again later."))

        if locked:
            form.add_error(None, _("Too many failed attempts. Please try again later."))
        context = {
            **self.each_context(request),
            "title": _("Two-factor authentication"),
            "subtitle": None,
            "form": form,
            "username": user.get_username(),
            "retry_after": retry_after,
        }
        request.current_app = self.name
        return TemplateResponse(request, "admin/login_2fa.html", context, status=429 if locked else 200)
