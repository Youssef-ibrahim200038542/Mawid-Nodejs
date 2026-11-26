-- Account security (H1): email verification, session versioning, staff invitations,
-- membership trust, auth tokens and per-email rate buckets. Additive only: no DROP, no data rewrite.
-- Every existing membership becomes LEGACY_UNREVIEWED through the column default.

-- AlterTable
ALTER TABLE `clinic_members` ADD COLUMN `trust_source` ENUM('CLINIC_CREATOR', 'INVITATION', 'RECONFIRMATION') NULL,
    ADD COLUMN `trust_state` ENUM('LEGACY_UNREVIEWED', 'TRUSTED') NOT NULL DEFAULT 'LEGACY_UNREVIEWED',
    ADD COLUMN `trusted_at` DATETIME(3) NULL,
    ADD COLUMN `trusted_via_invitation_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `email_verified_at` DATETIME(3) NULL,
    ADD COLUMN `session_version` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `clinic_invitations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clinic_id` INTEGER NOT NULL,
    `kind` ENUM('NEW_MEMBER', 'RECONFIRM') NOT NULL,
    `member_id` INTEGER NULL,
    `email` VARCHAR(255) NOT NULL,
    `role` ENUM('OWNER', 'DOCTOR', 'RECEPTIONIST') NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED') NOT NULL DEFAULT 'PENDING',
    `active_key` CHAR(64) NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `invited_by_user_id` INTEGER NULL,
    `last_sent_at` DATETIME(3) NOT NULL,
    `send_count` INTEGER NOT NULL DEFAULT 1,
    `delivery_status` ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `delivery_error` VARCHAR(64) NULL,
    `accepted_at` DATETIME(3) NULL,
    `accepted_by_user_id` INTEGER NULL,
    `declined_at` DATETIME(3) NULL,
    `declined_by_user_id` INTEGER NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `clinic_invitations_active_key_key`(`active_key`),
    UNIQUE INDEX `clinic_invitations_token_hash_key`(`token_hash`),
    INDEX `clinic_invitations_clinic_id_status_idx`(`clinic_id`, `status`),
    INDEX `clinic_invitations_email_status_idx`(`email`, `status`),
    UNIQUE INDEX `clinic_invitations_clinic_id_id_key`(`clinic_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_tokens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `purpose` ENUM('EMAIL_VERIFY', 'PASSWORD_RESET', 'ACCOUNT_NOTICE') NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `consumed_reason` ENUM('USED', 'SUPERSEDED', 'EMAIL_CHANGED', 'NOTICE') NULL,
    `chain_started_at` DATETIME(3) NOT NULL,
    `replaces_token_id` INTEGER NULL,
    `send_attempts` SMALLINT NOT NULL DEFAULT 0,
    `delivery_status` ENUM('QUEUED', 'SENDING', 'SENT', 'RETRYABLE', 'FAILED', 'SKIPPED', 'REPLACED') NOT NULL DEFAULT 'QUEUED',
    `next_retry_at` DATETIME(3) NULL,
    `delivery_error` VARCHAR(64) NULL,

    UNIQUE INDEX `auth_tokens_token_hash_key`(`token_hash`),
    UNIQUE INDEX `auth_tokens_replaces_token_id_key`(`replaces_token_id`),
    INDEX `auth_tokens_user_id_purpose_consumed_at_idx`(`user_id`, `purpose`, `consumed_at`),
    INDEX `auth_tokens_delivery_status_next_retry_at_idx`(`delivery_status`, `next_retry_at`),
    INDEX `auth_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_rate_buckets` (
    `kind` ENUM('SIGNUP', 'PASSWORD_RESET') NOT NULL,
    `key_hash` CHAR(64) NOT NULL,
    `window_start` DATETIME(3) NOT NULL,
    `request_count` INTEGER NOT NULL DEFAULT 1,

    INDEX `auth_rate_buckets_window_start_idx`(`window_start`),
    PRIMARY KEY (`kind`, `key_hash`, `window_start`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `clinic_members_clinic_id_trusted_via_invitation_id_key` ON `clinic_members`(`clinic_id`, `trusted_via_invitation_id`);

-- AddForeignKey
ALTER TABLE `clinic_members` ADD CONSTRAINT `clinic_members_clinic_id_trusted_via_invitation_id_fkey` FOREIGN KEY (`clinic_id`, `trusted_via_invitation_id`) REFERENCES `clinic_invitations`(`clinic_id`, `id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `clinic_invitations` ADD CONSTRAINT `clinic_invitations_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinic_invitations` ADD CONSTRAINT `clinic_invitations_clinic_id_member_id_fkey` FOREIGN KEY (`clinic_id`, `member_id`) REFERENCES `clinic_members`(`clinic_id`, `id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `clinic_invitations` ADD CONSTRAINT `clinic_invitations_invited_by_user_id_fkey` FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinic_invitations` ADD CONSTRAINT `clinic_invitations_accepted_by_user_id_fkey` FOREIGN KEY (`accepted_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinic_invitations` ADD CONSTRAINT `clinic_invitations_declined_by_user_id_fkey` FOREIGN KEY (`declined_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clinic_invitations` ADD CONSTRAINT `clinic_invitations_revoked_by_user_id_fkey` FOREIGN KEY (`revoked_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_replaces_token_id_fkey` FOREIGN KEY (`replaces_token_id`) REFERENCES `auth_tokens`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;


-- CheckConstraints (hand-written; MariaDB 10.4 enforces CHECK. Prisma does not model them.)
-- Columns referenced here never carry a CASCADE / SET NULL foreign-key action (see ON UPDATE NO ACTION above);
-- actor user ids (ON DELETE SET NULL) are deliberately left out and enforced in the services.
ALTER TABLE `users` ADD CONSTRAINT `users_session_version_check` CHECK (`session_version` >= 0);

ALTER TABLE `clinic_members` ADD CONSTRAINT `clinic_members_trust_check` CHECK (
    (`trust_state` = 'LEGACY_UNREVIEWED' AND `trusted_at` IS NULL AND `trust_source` IS NULL AND `trusted_via_invitation_id` IS NULL)
    OR (`trust_state` = 'TRUSTED' AND `trusted_at` IS NOT NULL AND (
        (`trust_source` = 'CLINIC_CREATOR' AND `trusted_via_invitation_id` IS NULL)
        OR (`trust_source` IN ('INVITATION', 'RECONFIRMATION') AND `trusted_via_invitation_id` IS NOT NULL)))
);

ALTER TABLE `clinic_invitations` ADD CONSTRAINT `clinic_invitations_kind_member_check` CHECK ((`kind` = 'RECONFIRM') = (`member_id` IS NOT NULL));
ALTER TABLE `clinic_invitations` ADD CONSTRAINT `clinic_invitations_send_check` CHECK (`send_count` >= 1 AND `expires_at` > `created_at`);
ALTER TABLE `clinic_invitations` ADD CONSTRAINT `clinic_invitations_status_check` CHECK (
    (`status` = 'PENDING' AND `active_key` IS NOT NULL AND `accepted_at` IS NULL AND `declined_at` IS NULL AND `revoked_at` IS NULL)
    OR (`status` = 'ACCEPTED' AND `active_key` IS NULL AND `accepted_at` IS NOT NULL AND `declined_at` IS NULL AND `revoked_at` IS NULL)
    OR (`status` = 'DECLINED' AND `active_key` IS NULL AND `declined_at` IS NOT NULL AND `accepted_at` IS NULL AND `revoked_at` IS NULL)
    OR (`status` = 'REVOKED' AND `active_key` IS NULL AND `revoked_at` IS NOT NULL AND `accepted_at` IS NULL AND `declined_at` IS NULL)
);
ALTER TABLE `clinic_invitations` ADD CONSTRAINT `clinic_invitations_delivery_error_check` CHECK (`delivery_error` IS NULL OR `delivery_status` = 'FAILED');

ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_consumed_check` CHECK ((`consumed_at` IS NULL) = (`consumed_reason` IS NULL));
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_notice_check` CHECK ((`purpose` = 'ACCOUNT_NOTICE') = (`consumed_reason` <=> 'NOTICE'));
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_expiry_check` CHECK (`expires_at` > `created_at`);
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_attempts_check` CHECK (`send_attempts` BETWEEN 0 AND 3 AND (`delivery_status` <> 'SENDING' OR `send_attempts` >= 1));
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_retry_check` CHECK ((`next_retry_at` IS NOT NULL) = (`delivery_status` IN ('QUEUED', 'SENDING', 'RETRYABLE')));
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_delivery_error_check` CHECK (`delivery_error` IS NULL OR `delivery_status` IN ('RETRYABLE', 'FAILED', 'REPLACED'));
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_replaced_check` CHECK (`delivery_status` <> 'REPLACED' OR `consumed_at` IS NOT NULL);

ALTER TABLE `auth_rate_buckets` ADD CONSTRAINT `auth_rate_buckets_count_check` CHECK (`request_count` >= 1);
