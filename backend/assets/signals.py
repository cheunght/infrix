from django.contrib.auth.models import Group, User
from django.core.exceptions import ValidationError
from django.db.models.signals import post_save, pre_delete, pre_save
from django.dispatch import receiver

from .models import UserSecurityProfile
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
    if update_fields is not None and "password" not in update_fields:
        instance._password_changed = False
        return
    old_password = sender.objects.filter(pk=instance.pk).values_list("password", flat=True).first()
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
