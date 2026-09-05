import json
import socket
import ssl
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.test import override_settings
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APIClient

from assets.ldap_auth import LDAPDirectoryClient
from assets.models import AuditLog, AuthThrottleState, DirectoryIdentity
from assets.roles import ensure_preset_groups
from assets.serializers import UserSerializer


LDAP_TEST_SETTINGS = {
    "LDAP_ENABLED": True,
    "LDAP_SERVER_URI": "ldaps://directory.example.internal:636",
    "LDAP_TLS_SERVER_NAME": "directory.example.internal",
    "LDAP_BIND_DN": "CN=infrix-bind,OU=Service Accounts,DC=example,DC=internal",
    "LDAP_BIND_PASSWORD": "directory-test-secret",
    "LDAP_USER_BASE_DN": "OU=Users,DC=example,DC=internal",
    "LDAP_USER_FILTER": "(&(objectClass=user)(sAMAccountName={username}))",
    "LDAP_USERNAME_ATTRIBUTE": "sAMAccountName",
    "LDAP_EXTERNAL_ID_ATTRIBUTE": "objectGUID",
    "LDAP_EMAIL_ATTRIBUTE": "mail",
    "LDAP_FIRST_NAME_ATTRIBUTE": "givenName",
    "LDAP_LAST_NAME_ATTRIBUTE": "sn",
    "LDAP_AD_ACCOUNT_CONTROL_ATTRIBUTE": "userAccountControl",
    "LDAP_CONNECT_TIMEOUT": 5,
    "LDAP_OPERATION_TIMEOUT": 5,
    "LDAP_STARTTLS": False,
    "LDAP_TLS_VALIDATE": True,
    "LDAP_CA_CERT_FILE": "",
}


def make_user(username: str, *, system_admin: bool = False) -> User:
    user = User.objects.create_user(username=username, password="local-secret")
    if system_admin:
        user.groups.set([ensure_preset_groups()["system_admin"]])
    return user


def admin_client(username: str = "ldap-admin") -> APIClient:
    client = APIClient()
    client.force_authenticate(user=make_user(username, system_admin=True))
    return client


@pytest.mark.django_db
def test_ldap_status_requires_system_admin_and_never_returns_secrets():
    anonymous = APIClient().get("/api/v1/auth/ldap/status/")
    assert anonymous.status_code in {401, 403}

    regular = APIClient()
    regular.force_authenticate(user=make_user("asset-viewer"))
    assert regular.get("/api/v1/auth/ldap/status/").status_code == 403

    with override_settings(LDAP_ENABLED=False):
        disabled = admin_client("ldap-admin-disabled").get("/api/v1/auth/ldap/status/")
    assert disabled.status_code == 200
    assert disabled.data["enabled"] is False
    assert disabled.data["configured"] is False
    assert "directory-test-secret" not in json.dumps(disabled.data)

    with override_settings(**LDAP_TEST_SETTINGS):
        response = admin_client("ldap-admin-enabled").get("/api/v1/auth/ldap/status/")
    assert response.status_code == 200
    assert response.data["enabled"] is True
    assert response.data["configured"] is True
    assert response.data["tls_mode"] == "ldaps"
    assert response.data["ad_specific_mode"] is True
    serialized = json.dumps(response.data)
    assert "directory-test-secret" not in serialized
    assert LDAP_TEST_SETTINGS["LDAP_BIND_DN"] not in serialized
    assert LDAP_TEST_SETTINGS["LDAP_USER_FILTER"] not in serialized


@pytest.mark.django_db
def test_ldap_diagnostic_disabled_and_permission_boundary():
    regular = APIClient()
    regular.force_authenticate(user=make_user("ldap-regular"))
    assert regular.post("/api/v1/auth/ldap/diagnostics/", {}, format="json").status_code == 403

    with override_settings(LDAP_ENABLED=False):
        response = admin_client().post("/api/v1/auth/ldap/diagnostics/", {}, format="json")
    assert response.status_code == 200
    assert response.data["success"] is False
    assert response.data["code"] == "disabled"
    assert response.data["stage"] == "configuration"


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("code", "stage", "status_code"),
    [
        ("configuration_error", "configuration", 400),
        ("connection_error", "connection", 503),
        ("timeout", "connection", 503),
        ("tls_error", "tls", 503),
        ("bind_error", "service_bind", 503),
        ("search_error", "search", 503),
    ],
)
def test_ldap_diagnostic_returns_safe_stable_failure_contract(code, stage, status_code):
    result = {
        "success": False,
        "stage": stage,
        "checks": [{"name": stage, "status": "error"}],
        "code": code,
        "message": "raw exception must not be used",
    }
    with override_settings(**LDAP_TEST_SETTINGS), patch(
        "assets.views.LDAPDirectoryClient.diagnose", return_value=result
    ):
        response = admin_client().post("/api/v1/auth/ldap/diagnostics/", {}, format="json")
    assert response.status_code == status_code
    assert response.data["success"] is False
    assert response.data["stage"] == stage
    assert response.data["code"] == code
    assert "raw exception" not in json.dumps(response.data)
    audit = AuditLog.objects.filter(action="ldap_diagnostic").latest("id")
    assert audit.payload["extra"]["code"] == code
    assert audit.payload["extra"]["stage"] == stage


@pytest.mark.django_db
def test_ldap_diagnostic_success_and_throttle():
    result = {
        "success": True,
        "stage": "search",
        "checks": [
            {"name": "configuration", "status": "success"},
            {"name": "connection", "status": "success"},
            {"name": "tls", "status": "success"},
            {"name": "service_bind", "status": "success"},
            {"name": "search", "status": "success"},
        ],
    }
    with override_settings(**LDAP_TEST_SETTINGS), patch(
        "assets.views.LDAPDirectoryClient.diagnose", return_value=result
    ):
        client = admin_client()
        responses = [client.post("/api/v1/auth/ldap/diagnostics/", {}, format="json") for _ in range(4)]
    assert [response.status_code for response in responses] == [200, 200, 200, 429]
    assert responses[0].data["success"] is True
    assert responses[-1].data["code"] == "diagnostic_throttled"
    assert AuthThrottleState.objects.filter(key__startswith="ldap-diagnostic:").exists()


@pytest.mark.django_db
def test_ldap_diagnostic_unexpected_exception_does_not_leak_raw_error():
    with override_settings(**LDAP_TEST_SETTINGS), patch(
        "assets.views.LDAPDirectoryClient.diagnose",
        side_effect=RuntimeError("bind_password=directory-test-secret dn=CN=private"),
    ):
        response = admin_client().post("/api/v1/auth/ldap/diagnostics/", {}, format="json")
    assert response.status_code == 503
    assert response.data["code"] == "unexpected_error"
    serialized = json.dumps(response.data)
    assert "directory-test-secret" not in serialized
    assert "CN=private" not in serialized


class FakeConnection:
    def __init__(self, failure=None):
        self.failure = failure
        self.entries = []

    def open(self):
        if self.failure == "connection":
            raise socket.timeout()
        if self.failure == "tls_open":
            raise ssl.SSLError("private TLS details")
        return True

    def start_tls(self):
        return self.failure != "tls"

    def bind(self):
        return self.failure != "bind"

    def search(self, **_kwargs):
        return self.failure != "search"

    def unbind(self):
        return True


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("failure", "expected_code", "expected_stage"),
    [
        (None, None, "search"),
        ("connection", "timeout", "connection"),
        ("tls_open", "tls_error", "connection"),
        ("bind", "bind_error", "service_bind"),
        ("search", "search_error", "search"),
    ],
)
def test_ldap_directory_client_stages_diagnostics_without_network(failure, expected_code, expected_stage):
    def connection_factory(*_args, **_kwargs):
        return FakeConnection(failure)

    with override_settings(**LDAP_TEST_SETTINGS):
        if failure == "tls":
            settings = dict(LDAP_TEST_SETTINGS, LDAP_SERVER_URI="ldap://directory.example.internal:389", LDAP_STARTTLS=True)
        else:
            settings = LDAP_TEST_SETTINGS
        with override_settings(**settings):
            result = LDAPDirectoryClient(
                connection_factory=connection_factory,
                server_factory=lambda *_args, **_kwargs: SimpleNamespace(),
            ).diagnose()
    assert result.stage == expected_stage
    assert result.code == expected_code
    assert result.success is (expected_code is None)


@pytest.mark.django_db
def test_user_serializer_distinguishes_local_and_directory_identity_without_external_id():
    local = make_user("local-user")
    directory = make_user("directory-user")
    identity = DirectoryIdentity.objects.create(
        user=directory,
        provider="ldap",
        external_id="private-external-id",
        current_login_identifier="directory-user",
        last_seen_at=timezone.now(),
    )
    local_payload = UserSerializer(local).data
    directory_payload = UserSerializer(directory).data
    assert local_payload["auth_source"] == "local"
    assert local_payload["directory_provider"] is None
    assert directory_payload["auth_source"] == "ldap"
    assert directory_payload["directory_provider"] == identity.provider
    assert directory_payload["directory_login_identifier"] == identity.current_login_identifier
    assert directory_payload["directory_last_seen_at"] is not None
    assert "external_id" not in directory_payload


@pytest.mark.django_db
def test_directory_password_reset_and_delete_are_protected():
    client = admin_client()
    directory = make_user("directory-protected")
    DirectoryIdentity.objects.create(
        user=directory,
        provider="ldap",
        external_id="protected-external-id",
        current_login_identifier="directory-protected",
    )

    reset = client.post(
        f"/api/v1/users/{directory.pk}/reset-password/",
        {"new_password": "new-local-secret", "confirm_password": "new-local-secret"},
        format="json",
    )
    assert reset.status_code == 400
    assert reset.data["code"] == "directory_password_managed"

    deleted = client.delete(f"/api/v1/users/{directory.pk}/")
    assert deleted.status_code == 400
    assert deleted.data["code"] == "directory_user_protected"
    assert User.objects.filter(pk=directory.pk).exists()
