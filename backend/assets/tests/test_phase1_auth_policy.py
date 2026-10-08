from datetime import timedelta
import time

from cryptography.fernet import Fernet
from django.contrib.auth.models import User
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase, APIClient

from assets.auth_security import generate_api_token, generate_totp_secret, _totp_digest
from assets.configuration_secrets import encrypt_secret
from assets.models import AuditLog, DirectoryIdentity, PersonalAccessToken, UserSecurityProfile, SystemSetting


class AccountPolicyTests(APITestCase):
    password = "Isolated-Password-834!"

    def setUp(self):
        self.admin = User.objects.create_superuser("policy-admin", "admin@example.test", self.password)
        self.target = User.objects.create_superuser("policy-target", "target@example.test", self.password)
        UserSecurityProfile.objects.filter(user__in=[self.admin, self.target]).update(
            must_change_password=False, password_changed_at=timezone.now(),
        )

    def token_client(self):
        raw, digest, prefix = generate_api_token()
        token = PersonalAccessToken.objects.create(user=self.target, name="policy test", token_hash=digest, token_prefix=prefix)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION="Bearer " + raw)
        return client, token

    def test_reset_revokes_existing_token_and_records_count(self):
        bearer, token = self.token_client()
        self.client.force_login(self.admin)
        response = self.client.post(f"/api/v1/users/{self.target.pk}/reset-password/", {
            "new_password": "Reset-Password-947!", "confirm_password": "Reset-Password-947!",
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        token.refresh_from_db()
        self.assertIsNotNone(token.revoked_at)
        self.assertEqual(bearer.get("/api/v1/assets/").status_code, 401)
        self.assertEqual(bearer.post("/api/v1/tags/", {"name": "forbidden"}, format="json").status_code, 401)
        log = AuditLog.objects.filter(resource_type="user", resource_id=str(self.target.pk)).latest("id")
        self.assertEqual(log.payload["extra"]["revoked_token_count"], 1)

    def test_bearer_and_session_enforce_required_password_change(self):
        bearer, _ = self.token_client()
        UserSecurityProfile.objects.filter(user=self.target).update(must_change_password=True)
        self.client.force_login(self.target)
        for client in [bearer, self.client]:
            response = client.get("/api/v1/assets/")
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json()["code"], "password_change_required")
            self.assertEqual(client.get("/api/v1/auth/me/").status_code, 200)
            self.assertEqual(client.post("/api/v1/tags/", {"name": "blocked"}, format="json").status_code, 403)

    def test_admin_required_password_redirects_to_application(self):
        UserSecurityProfile.objects.filter(user=self.target).update(must_change_password=True)
        response = self.client.post("/admin/login/", {"username": self.target.username, "password": self.password})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/")
        self.assertEqual(self.client.get("/admin/").status_code, 302)

    def test_admin_expired_local_password_redirects_to_application(self):
        SystemSetting.objects.update_or_create(pk=1, defaults={"password_expiry_days": 1})
        UserSecurityProfile.objects.filter(user=self.target).update(password_changed_at=timezone.now() - timedelta(days=2))
        response = self.client.post("/admin/login/", {"username": self.target.username, "password": self.password})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/")

    @override_settings(INFRIX_CONFIG_ENCRYPTION_KEY=Fernet.generate_key().decode())
    def test_admin_two_factor_invalid_code_then_required_password_redirect(self):
        secret = generate_totp_secret()
        UserSecurityProfile.objects.filter(user=self.target).update(
            must_change_password=True, two_factor_enabled=True,
            two_factor_secret_encrypted=encrypt_secret(secret),
        )
        response = self.client.post("/admin/login/", {"username": self.target.username, "password": self.password})
        self.assertEqual(response.status_code, 302)
        verification_url = response["Location"]
        self.assertNotIn("_auth_user_id", self.client.session)
        invalid = self.client.post(verification_url, {"code": "abcdef"})
        self.assertEqual(invalid.status_code, 200)
        self.assertTrue(invalid.context_data["form"].errors)
        self.assertNotIn("_auth_user_id", self.client.session)
        code = _totp_digest(secret, int(time.time()) // 30)
        response = self.client.post(verification_url, {"code": code})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/")
        self.assertEqual(self.client.get("/api/v1/assets/").status_code, 403)

    def test_directory_password_is_not_expired_by_local_policy(self):
        DirectoryIdentity.objects.create(user=self.target, external_id="policy-directory-id", current_login_identifier=self.target.username)
        SystemSetting.objects.update_or_create(pk=1, defaults={"password_expiry_days": 1})
        UserSecurityProfile.objects.filter(user=self.target).update(password_changed_at=timezone.now() - timedelta(days=2))
        self.client.force_login(self.target)
        bearer, _ = self.token_client()
        self.assertEqual(self.client.get("/api/v1/assets/").status_code, 200)
        self.assertEqual(bearer.get("/api/v1/assets/").status_code, 200)
        self.assertEqual(self.client.get("/admin/").status_code, 200)

    def test_api_failures_lock_actual_admin_http_entry(self):
        for _ in range(5):
            self.client.post("/api/v1/auth/login/", {"username": self.target.username, "password": "wrong"}, format="json")
        response = self.client.post("/admin/login/", {"username": self.target.username, "password": self.password})
        self.assertNotIn("_auth_user_id", self.client.session)
        self.assertContains(response, "Too many failed attempts")

    def test_admin_failures_lock_api_http_entry(self):
        for _ in range(5):
            self.client.post("/admin/login/", {"username": self.target.username, "password": "wrong"})
        response = self.client.post("/api/v1/auth/login/", {"username": self.target.username, "password": self.password}, format="json")
        self.assertEqual(response.status_code, 429)
        self.assertNotIn("_auth_user_id", self.client.session)
