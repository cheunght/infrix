import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from cryptography.fernet import Fernet
from django.test import SimpleTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase
from django.core.files.uploadedfile import SimpleUploadedFile

from assets.auth_security import generate_api_token
from assets.ldap_auth import LDAPDirectoryClient, LDAPInfrastructureFailure
from assets.ldap_configuration import (
    EffectiveLDAPConfiguration,
    configuration_errors,
)
from assets.models import (
    AssetModel,
    AuditLog,
    AuthThrottleState,
    DeviceType,
    DirectoryServiceConfiguration,
    Manufacturer,
    PersonalAccessToken,
    UserSecurityProfile,
)


class BackupDeleteApiTests(APITestCase):
    def setUp(self):
        self.user = self.create_superuser()
        self.client.force_authenticate(user=self.user)
        self.client.raise_request_exception = False
        self.backup_root = self.create_temp_directory()

    def create_superuser(self):
        from django.contrib.auth.models import User

        return User.objects.create_superuser(
            username="backup-admin",
            email="backup-admin@example.com",
            password="test-password-123",
        )

    def create_temp_directory(self):
        import tempfile

        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        return Path(directory.name)

    def backup_path(self):
        path = self.backup_root / "infrix-backup-20260922-010203.tar.gz"
        path.write_bytes(b"test backup")
        return path

    def delete_url(self, filename):
        return f"/api/v1/system/backups/{filename}/"

    @override_settings()
    def test_delete_success_uses_public_confirmation_contract_without_type_error(self):
        path = self.backup_path()
        with override_settings(INFRIX_BACKUP_DIR=path.parent), patch(
            "assets.backups.inspect_backup",
            return_value={"filename": path.name},
        ):
            response = self.client.delete(
                self.delete_url(path.name),
                {"confirmation": f"DELETE {path.name}"},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"deleted": True, "filename": path.name})
        self.assertFalse(path.exists())

    def test_delete_wrong_confirmation_is_rejected_without_removing_file(self):
        path = self.backup_path()
        with override_settings(INFRIX_BACKUP_DIR=path.parent):
            response = self.client.delete(
                self.delete_url(path.name),
                {"confirmation": "DELETE wrong-file.tar.gz"},
                format="json",
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "delete_confirmation_required")
        self.assertTrue(path.exists())

    def test_delete_missing_confirmation_is_rejected_without_removing_file(self):
        path = self.backup_path()
        with override_settings(INFRIX_BACKUP_DIR=path.parent):
            response = self.client.delete(self.delete_url(path.name), {}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "delete_confirmation_required")
        self.assertTrue(path.exists())

    def test_delete_not_found_returns_controlled_error(self):
        filename = "infrix-backup-20260922-010203.tar.gz"
        with override_settings(INFRIX_BACKUP_DIR=self.backup_root):
            response = self.client.delete(
                self.delete_url(filename),
                {"confirmation": f"DELETE {filename}"},
                format="json",
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "backup_not_found")


class LDAPTransportPolicyTests(SimpleTestCase):
    @staticmethod
    def valid_configuration(mode="none", *, enabled=True):
        return EffectiveLDAPConfiguration(
            enabled=enabled,
            primary_host="ldap.example.test",
            primary_port=389,
            base_dn="dc=example,dc=test",
            bind_dn="cn=service,dc=example,dc=test",
            bind_password="bind-secret",
            password_configured=True,
            security_mode=mode,
        )

    @override_settings(IS_PRODUCTION=False)
    def test_non_production_none_mode_remains_supported(self):
        self.assertNotIn("security_mode", configuration_errors(self.valid_configuration()))

    @override_settings(IS_PRODUCTION=True)
    def test_production_enabled_none_mode_is_rejected(self):
        errors = configuration_errors(self.valid_configuration())
        self.assertEqual(errors["security_mode"], "生产环境不允许使用明文 LDAP 传输")

    @override_settings(IS_PRODUCTION=True)
    def test_production_secure_modes_are_accepted_by_policy_validation(self):
        for mode in ("starttls", "ldaps"):
            with self.subTest(mode=mode):
                self.assertNotIn("security_mode", configuration_errors(self.valid_configuration(mode)))

    @override_settings(IS_PRODUCTION=True)
    def test_production_runtime_and_diagnostics_reject_none_before_connecting(self):
        server_factory = Mock()
        configuration = self.valid_configuration()
        client = LDAPDirectoryClient(configuration=configuration, server_factory=server_factory)

        with self.assertRaises(LDAPInfrastructureFailure) as raised:
            client._server(configuration)
        self.assertEqual(raised.exception.reason, "ldap_insecure_transport")
        server_factory.assert_not_called()

        diagnostic = client.diagnose(configuration, allow_disabled=True)
        self.assertFalse(diagnostic.success)
        self.assertEqual(diagnostic.code, "insecure_transport")
        server_factory.assert_not_called()

    @override_settings(IS_PRODUCTION=True)
    def test_production_authentication_rejects_none_before_connecting(self):
        server_factory = Mock()
        configuration = self.valid_configuration()
        client = LDAPDirectoryClient(configuration=configuration, server_factory=server_factory)

        with self.assertRaises(LDAPInfrastructureFailure) as raised:
            client.authenticate("alice", "password")

        self.assertEqual(raised.exception.reason, "ldap_insecure_transport")
        server_factory.assert_not_called()


class LDAPTransportPolicyApiTests(APITestCase):
    def setUp(self):
        from django.contrib.auth.models import User

        self.user = User.objects.create_superuser(
            username="ldap-admin",
            email="ldap-admin@example.com",
            password="test-password-123",
        )
        self.client.force_authenticate(user=self.user)
        DirectoryServiceConfiguration.objects.create(
            enabled=True,
            primary_host="ldap.example.test",
            primary_port=389,
            base_dn="dc=example,dc=test",
            bind_dn="cn=service,dc=example,dc=test",
            security_mode="none",
        )

    @override_settings(IS_PRODUCTION=True)
    def test_diagnostics_endpoint_rejects_saved_insecure_transport(self):
        response = self.client.post("/api/v1/auth/ldap/diagnostics/", {}, format="json")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "insecure_transport")


class TwoFactorManagementThrottleTests(APITestCase):
    endpoint_prefix = "/api/v1/auth/2fa/"
    throttle_policy = SimpleNamespace(
        login_window_seconds=900,
        login_lock_seconds=60,
        login_max_attempts=2,
    )

    def setUp(self):
        from django.contrib.auth.models import User

        self.user = User.objects.create_user("security-user", password="test-password-123")
        self.profile, _ = UserSecurityProfile.objects.get_or_create(user=self.user)
        self.profile.two_factor_secret_encrypted = "sealed-secret"
        self.profile.save(update_fields=["two_factor_secret_encrypted"])
        self.client.force_authenticate(user=self.user)

    def two_factor_url(self, action):
        return f"{self.endpoint_prefix}{action}/"

    def assert_throttle_reset(self):
        for scope, key in (
            ("account", f"two-factor-account:{self.user.pk}"),
            ("ip", "two-factor-ip:127.0.0.1"),
        ):
            state = AuthThrottleState.objects.filter(scope=scope, key=key).first()
            if state is not None:
                self.assertEqual(state.failure_count, 0)
                self.assertIsNone(state.locked_until)

    @patch("assets.views.totp_step_for_code", return_value=123)
    @patch("assets.views._two_factor_secret", return_value="secret")
    @patch("assets.auth_throttle._security_policy")
    def test_setup_confirmation_accepts_code_and_resets_existing_failures(
        self,
        policy,
        _secret,
        _totp,
    ):
        policy.return_value = self.throttle_policy
        AuthThrottleState.objects.create(
            scope="account",
            key=f"two-factor-account:{self.user.pk}",
            failure_count=1,
            first_failed_at=timezone.now(),
        )

        response = self.client.post(
            self.two_factor_url("confirm"),
            {"code": "123456"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.profile.refresh_from_db()
        self.assertTrue(self.profile.two_factor_enabled)
        self.assert_throttle_reset()

    @patch("assets.views.totp_step_for_code", return_value=None)
    @patch("assets.views._two_factor_secret", return_value="secret")
    @patch("assets.auth_throttle._security_policy")
    def test_setup_confirmation_wrong_code_increments_and_locks(
        self,
        policy,
        _secret,
        _totp,
    ):
        policy.return_value = self.throttle_policy

        first = self.client.post(self.two_factor_url("confirm"), {"code": "000000"}, format="json")
        second = self.client.post(self.two_factor_url("confirm"), {"code": "000000"}, format="json")

        self.assertEqual(first.status_code, 400)
        self.assertEqual(first.json()["code"], "invalid_two_factor_code")
        self.assertEqual(second.status_code, 429)
        self.assertEqual(second.json()["code"], "two_factor_locked")
        self.assertGreaterEqual(
            AuthThrottleState.objects.get(
                scope="account",
                key=f"two-factor-account:{self.user.pk}",
            ).failure_count,
            2,
        )

    @patch("assets.views.totp_step_for_code", return_value=456)
    @patch("assets.views._two_factor_secret", return_value="secret")
    @patch("assets.auth_throttle._security_policy")
    def test_disable_accepts_code_and_clears_secret_and_failures(
        self,
        policy,
        _secret,
        _totp,
    ):
        policy.return_value = self.throttle_policy
        self.profile.two_factor_enabled = True
        self.profile.save(update_fields=["two_factor_enabled"])
        AuthThrottleState.objects.create(
            scope="account",
            key=f"two-factor-account:{self.user.pk}",
            failure_count=1,
            first_failed_at=timezone.now(),
        )

        response = self.client.post(
            self.two_factor_url("disable"),
            {"code": "123456"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.profile.refresh_from_db()
        self.assertFalse(self.profile.two_factor_enabled)
        self.assertEqual(self.profile.two_factor_secret_encrypted, "")
        self.assert_throttle_reset()

    @patch("assets.views.totp_step_for_code", return_value=None)
    @patch("assets.views._two_factor_secret", return_value="secret")
    @patch("assets.auth_throttle._security_policy")
    def test_disable_wrong_code_is_throttled(
        self,
        policy,
        _secret,
        _totp,
    ):
        policy.return_value = self.throttle_policy
        self.profile.two_factor_enabled = True
        self.profile.save(update_fields=["two_factor_enabled"])

        first = self.client.post(self.two_factor_url("disable"), {"code": "000000"}, format="json")
        second = self.client.post(self.two_factor_url("disable"), {"code": "000000"}, format="json")

        self.assertEqual(first.status_code, 400)
        self.assertEqual(second.status_code, 429)
        self.profile.refresh_from_db()
        self.assertTrue(self.profile.two_factor_enabled)

    def test_bearer_token_cannot_invoke_management_endpoint(self):
        raw_token, token_hash, token_prefix = generate_api_token()
        PersonalAccessToken.objects.create(
            user=self.user,
            name="security-test",
            token_prefix=token_prefix,
            token_hash=token_hash,
        )
        self.client.force_authenticate(user=None, token=None)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {raw_token}")

        response = self.client.post(
            self.two_factor_url("confirm"),
            {"code": "123456"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)


class AuditTransactionBoundaryTests(APITestCase):
    def setUp(self):
        from django.contrib.auth.models import User

        self.user = User.objects.create_superuser(
            username="transaction-admin",
            email="transaction-admin@example.com",
            password="test-password-123",
        )
        self.client.force_authenticate(user=self.user)
        self.client.raise_request_exception = False

    def create_ldap_configuration(self):
        return DirectoryServiceConfiguration.objects.create(
            enabled=False,
            primary_host="ldap.example.test",
            primary_port=389,
            base_dn="dc=example,dc=test",
            bind_dn="cn=service,dc=example,dc=test",
            security_mode="ldaps",
        )

    def test_api_token_creation_rolls_back_when_audit_fails(self):
        with patch("assets.views.write_audit_log", side_effect=RuntimeError("audit unavailable")):
            response = self.client.post(
                "/api/v1/auth/api-tokens/",
                {"name": "transaction-test"},
                format="json",
            )

        self.assertEqual(response.status_code, 500)
        self.assertFalse(PersonalAccessToken.objects.filter(user=self.user).exists())

    def test_api_token_revocation_rolls_back_when_audit_fails(self):
        raw_token, token_hash, token_prefix = generate_api_token()
        token = PersonalAccessToken.objects.create(
            user=self.user,
            name="revoke-test",
            token_prefix=token_prefix,
            token_hash=token_hash,
        )

        with patch("assets.views.write_audit_log", side_effect=RuntimeError("audit unavailable")):
            response = self.client.delete(f"/api/v1/auth/api-tokens/{token.pk}/")

        self.assertEqual(response.status_code, 500)
        token.refresh_from_db()
        self.assertIsNone(token.revoked_at)

    def test_ldap_configuration_save_rolls_back_when_audit_fails(self):
        configuration = self.create_ldap_configuration()

        with patch("assets.views.write_audit_log", side_effect=RuntimeError("audit unavailable")):
            response = self.client.patch(
                "/api/v1/auth/ldap/config/",
                {"primary_host": "changed.example.test"},
                format="json",
            )

        self.assertEqual(response.status_code, 500)
        configuration.refresh_from_db()
        self.assertEqual(configuration.primary_host, "ldap.example.test")

    @override_settings(INFRIX_CONFIG_ENCRYPTION_KEY=Fernet.generate_key().decode())
    def test_ldap_audit_does_not_contain_plaintext_bind_password(self):
        self.create_ldap_configuration()

        response = self.client.patch(
            "/api/v1/auth/ldap/config/",
            {"bind_password": "plain-bind-password"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        payload = json.dumps(
            list(AuditLog.objects.filter(resource_type="ldap").values_list("payload", flat=True)),
            ensure_ascii=False,
        )
        self.assertNotIn("plain-bind-password", payload)

    def test_asset_model_import_rolls_back_when_audit_fails(self):
        manufacturer = Manufacturer.objects.create(name="Acme", code="acme")
        device_type = DeviceType.objects.create(name="Server")

        def create_model(_upload):
            return [
                AssetModel.objects.create(
                    name="Rollback Model",
                    manufacturer=manufacturer,
                    device_type=device_type,
                )
            ]

        upload = SimpleUploadedFile("models.xlsx", b"test", content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        with patch("assets.views.commit_asset_model_import", side_effect=create_model), patch(
            "assets.views.write_audit_log",
            side_effect=RuntimeError("audit unavailable"),
        ):
            response = self.client.post(
                "/api/v1/asset-models/import/",
                {"file": upload},
                format="multipart",
            )

        self.assertEqual(response.status_code, 500)
        self.assertFalse(AssetModel.objects.filter(name="Rollback Model").exists())
