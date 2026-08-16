from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.db.models.signals import pre_delete, pre_save
from django.dispatch import receiver

from .roles import ROLE_NAME_TO_CODE


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
