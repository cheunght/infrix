from django.contrib.auth.models import Group, User
from django.db.models import F
from django.db.models.signals import m2m_changed, post_delete, post_save, pre_delete, pre_save
from django.dispatch import receiver

from .models import Asset, AssetCustomValue, AssetNetworkAddress, AssetTag, MaintenanceContract, Person, ProcurementRecord, RackUnitAllocation, UserSecurityProfile
from .organization_access import (
    protect_preset_role_delete as enforce_preset_role_delete,
    protect_preset_role_rename as enforce_preset_role_rename,
)
from .system_settings import get_runtime_preferences


def advance_asset_revision(sender, instance, **kwargs):
    # Related configuration is part of the same editable asset, even when
    # written by imports, inventory correction or a dedicated action.
    if kwargs.get("raw"):
        return
    Asset.objects.filter(pk=instance.asset_id).update()


for _asset_configuration_model in (
    AssetCustomValue, AssetNetworkAddress, AssetTag, MaintenanceContract,
    ProcurementRecord, RackUnitAllocation,
):
    post_save.connect(advance_asset_revision, sender=_asset_configuration_model)
    post_delete.connect(advance_asset_revision, sender=_asset_configuration_model)


@receiver(pre_save, sender=Group)
def protect_preset_role_rename(sender, instance, **kwargs):
    enforce_preset_role_rename(instance)


@receiver(pre_delete, sender=Group)
def protect_preset_role_delete(sender, instance, **kwargs):
    enforce_preset_role_delete(instance)


@receiver(pre_save, sender=User)
def detect_user_password_change(sender, instance, **kwargs):
    if not instance.pk:
        instance._password_changed = False
        instance._administration_changed = False
        return
    update_fields = kwargs.get("update_fields")
    fields = ("password", "username", "first_name", "last_name", "email", "is_active", "is_staff", "is_superuser")
    previous = sender.objects.filter(pk=instance.pk).values(*fields).first()
    instance._administration_changed = bool(previous) and any(
        previous[field] != getattr(instance, field)
        for field in fields if update_fields is None or field in update_fields
    )
    if update_fields is not None and "password" not in update_fields:
        instance._password_changed = False
        return
    old_password = previous["password"] if previous else None
    instance._password_changed = bool(old_password and old_password != instance.password)


@receiver(post_save, sender=User)
def ensure_user_security_profile(sender, instance, created, **kwargs):
    if kwargs.get("raw"):
        return
    profile, profile_created = UserSecurityProfile.objects.get_or_create(
        user=instance,
        defaults={
            "must_change_password": bool(created),
            "locale": get_runtime_preferences().default_locale,
        },
    )
    if not profile_created and getattr(instance, "_password_changed", False):
        profile.must_change_password = True
        profile.password_changed_at = None
        profile.save(update_fields=["must_change_password", "password_changed_at", "updated_at"])
    if not created and getattr(instance, "_administration_changed", False):
        UserSecurityProfile.objects.filter(user=instance).update(administration_revision=F("administration_revision") + 1)
        instance._state.fields_cache.pop("security_profile", None)

    selected_person_id = getattr(instance, "_selected_person_id", None)
    if selected_person_id:
        person = Person.objects.get(pk=selected_person_id)
        if person.account_id not in (None, instance.pk):
            raise ValidationError("该人员已经关联其他系统账号")
        if person.account_id != instance.pk:
            Person.objects.filter(pk=person.pk).update(account_id=instance.pk)
        return

    # Account lifecycle is intentionally independent from the person record:
    # disabling or deleting a login must not disable or release the person's
    # assets, and account profile edits must not overwrite directory data.
    Person.objects.get_or_create(
        account=instance,
        defaults={
            "name": instance.get_full_name().strip() or instance.username,
            "is_active": True,
        },
    )


@receiver(m2m_changed, sender=User.groups.through)
def advance_user_role_revision(sender, instance, action, reverse, pk_set, **kwargs):
    if action == "pre_clear":
        instance._revision_user_ids = list(instance.user_set.values_list("pk", flat=True)) if reverse else [instance.pk]
    if action not in {"post_add", "post_remove", "post_clear"}:
        return
    user_ids = getattr(instance, "_revision_user_ids", ()) if action == "post_clear" else (pk_set if reverse else [instance.pk])
    if user_ids:
        UserSecurityProfile.objects.filter(user_id__in=user_ids).update(administration_revision=F("administration_revision") + 1)
    if not reverse:
        instance._state.fields_cache.pop("security_profile", None)
