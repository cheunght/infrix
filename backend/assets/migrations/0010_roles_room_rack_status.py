from django.conf import settings
from django.db import migrations, models


ROLE_NAMES = {
    "system_admin": "系统管理员",
    "asset_admin": "资产管理员",
    "repairer": "维修人员",
    "auditor": "只读审计员",
}


def create_roles_and_assign_users(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    groups = {
        code: Group.objects.get_or_create(name=name)[0]
        for code, name in ROLE_NAMES.items()
    }
    for user in User.objects.all():
        user.groups.clear()
        user.groups.add(
            groups["system_admin"] if user.is_superuser else groups["auditor"]
        )


class Migration(migrations.Migration):
    dependencies = [
        ("assets", "0009_repair_asset_dictionary_columns"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="serverroom",
            name="is_active",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="rack",
            name="is_active",
            field=models.BooleanField(default=True),
        ),
        migrations.RunPython(create_roles_and_assign_users, migrations.RunPython.noop),
    ]
