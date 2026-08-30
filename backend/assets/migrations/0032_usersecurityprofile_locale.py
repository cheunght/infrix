from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("assets", "0031_systemsetting"),
    ]

    operations = [
        migrations.AddField(
            model_name="usersecurityprofile",
            name="locale",
            field=models.CharField(
                choices=[("zh-CN", "简体中文"), ("en-US", "English")],
                default="zh-CN",
                max_length=10,
            ),
        ),
    ]
