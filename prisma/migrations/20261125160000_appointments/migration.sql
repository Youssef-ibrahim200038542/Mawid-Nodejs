-- CreateTable
CREATE TABLE `patients` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clinic_id` INTEGER NOT NULL,
    `user_id` INTEGER NULL,
    `full_name` VARCHAR(150) NOT NULL,
    `phone` VARCHAR(30) NULL,
    `email` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `patients_clinic_id_phone_idx`(`clinic_id`, `phone`),
    INDEX `patients_clinic_id_email_idx`(`clinic_id`, `email`),
    INDEX `patients_user_id_idx`(`user_id`),
    UNIQUE INDEX `patients_clinic_id_user_id_key`(`clinic_id`, `user_id`),
    UNIQUE INDEX `patients_clinic_id_id_key`(`clinic_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appointments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clinic_id` INTEGER NOT NULL,
    `doctor_id` INTEGER NOT NULL,
    `service_id` INTEGER NOT NULL,
    `patient_id` INTEGER NOT NULL,
    `starts_at` DATETIME(3) NOT NULL,
    `ends_at` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW') NOT NULL DEFAULT 'PENDING',
    `source` ENUM('ONLINE', 'STAFF') NOT NULL,
    `duration_minutes` INTEGER NOT NULL,
    `price_minor` INTEGER NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `note` VARCHAR(500) NULL,
    `created_by_user_id` INTEGER NULL,
    `confirmed_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancelled_by_user_id` INTEGER NULL,
    `cancellation_reason` VARCHAR(255) NULL,
    `reschedule_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `appointments_doctor_id_starts_at_idx`(`doctor_id`, `starts_at`),
    INDEX `appointments_clinic_id_starts_at_idx`(`clinic_id`, `starts_at`),
    INDEX `appointments_patient_id_starts_at_idx`(`patient_id`, `starts_at`),
    INDEX `appointments_clinic_id_status_starts_at_idx`(`clinic_id`, `status`, `starts_at`),
    UNIQUE INDEX `appointments_clinic_id_id_key`(`clinic_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `patients` ADD CONSTRAINT `patients_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `patients` ADD CONSTRAINT `patients_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_clinic_id_doctor_id_fkey` FOREIGN KEY (`clinic_id`, `doctor_id`) REFERENCES `doctor_profiles`(`clinic_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_clinic_id_service_id_fkey` FOREIGN KEY (`clinic_id`, `service_id`) REFERENCES `services`(`clinic_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_clinic_id_patient_id_fkey` FOREIGN KEY (`clinic_id`, `patient_id`) REFERENCES `patients`(`clinic_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- CheckConstraints (hand-written; Prisma does not model them)
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_range_check` CHECK (`starts_at` < `ends_at`);
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_duration_check` CHECK (`duration_minutes` BETWEEN 5 AND 480);
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_price_check` CHECK (`price_minor` >= 0);
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_reschedule_check` CHECK (`reschedule_count` >= 0);
