from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("assets", "0001_initial")]
    operations = [migrations.DeleteModel(name="BackgroundJob")]
