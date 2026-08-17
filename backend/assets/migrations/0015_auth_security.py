from django.conf import settings
from django.db import migrations, models
from django.db.models import deletion


def create_existing_security_profiles(apps, schema_editor):
    User = apps.get_model("auth", "User")
    UserSecurityProfile = apps.get_model("assets", "UserSecurityProfile")
    UserSecurityProfile.objects.bulk_create(
        [UserSecurityProfile(user_id=user_id, must_change_password=False) for user_id in User.objects.values_list("id", flat=True)],
        ignore_conflicts=True,
    )


class Migration(migrations.Migration):
    dependencies = [
        ("assets", "0014_facility_management_fields"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="UserSecurityProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("must_change_password", models.BooleanField(default=False)),
                ("password_changed_at", models.DateTimeField(blank=True, null=True)),
                (
                    "user",
                    models.OneToOneField(
                        on_delete=deletion.CASCADE,
                        related_name="security_profile",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"abstract": False},
        ),
        migrations.CreateModel(
            name="AuthThrottleState",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("scope", models.CharField(choices=[("account", "账号"), ("ip", "IP")], max_length=16)),
                ("key", models.CharField(max_length=255)),
                ("failure_count", models.PositiveIntegerField(default=0)),
                ("first_failed_at", models.DateTimeField(blank=True, null=True)),
                ("locked_until", models.DateTimeField(blank=True, null=True)),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=("scope", "key"), name="uniq_auth_throttle_scope_key"),
                ],
                "indexes": [models.Index(fields=["scope", "key"], name="assets_auth_scope_9fd68f_idx")],
            },
        ),
        migrations.RunPython(create_existing_security_profiles, migrations.RunPython.noop),
    ]
