from django.contrib.auth.models import Group, User
from django.core.exceptions import ValidationError
from django.db.models.signals import post_save, pre_delete, pre_save
from django.dispatch import receiver

from .models import Person, UserSecurityProfile
from .roles import ROLE_NAME_TO_CODE
from .system_settings import get_system_settings


@receiver(pre_save, sender=Group)
def protect_preset_role_rename(sender, instance, **kwargs):
    if not instance.pk:
        return
    original = Group.objects.filter(pk=instance.pk).values_list("name", flat=True).first()
    if original in ROLE_NAME_TO_CODE and instance.name != original:
        raise ValidationError("预设角色不能重命名")


@receiver(pre_delete, sender=Group)
def protect_preset_role_delete(sender, instance, **kwargs):
    if instance.name in ROLE_NAME_TO_CODE:
        raise ValidationError("预设角色不能删除")


@receiver(pre_save, sender=User)
def detect_user_password_change(sender, instance, **kwargs):
    if not instance.pk:
        instance._password_changed = False
        return
    update_fields = kwargs.get("update_fields")
    previous = sender.objects.filter(pk=instance.pk).values("password").first()
    if update_fields is not None and "password" not in update_fields:
        instance._password_changed = False
        return
    old_password = previous["password"] if previous else None
    instance._password_changed = bool(old_password and old_password != instance.password)


@receiver(post_save, sender=User)
def ensure_user_security_profile(sender, instance, created, **kwargs):
    profile, profile_created = UserSecurityProfile.objects.get_or_create(
        user=instance,
        defaults={
            "must_change_password": bool(created),
            "locale": get_system_settings().default_locale,
        },
    )
    if not profile_created and getattr(instance, "_password_changed", False):
        profile.must_change_password = True
        profile.password_changed_at = None
        profile.save(update_fields=["must_change_password", "password_changed_at", "updated_at"])

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
