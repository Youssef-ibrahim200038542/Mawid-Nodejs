-- CreateTable
CREATE TABLE `specialties` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clinic_id` INTEGER NOT NULL,
    `name_en` VARCHAR(100) NOT NULL,
    `name_ar` VARCHAR(100) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `specialties_clinic_id_name_en_key`(`clinic_id`, `name_en`),
    UNIQUE INDEX `specialties_clinic_id_name_ar_key`(`clinic_id`, `name_ar`),
    UNIQUE INDEX `specialties_clinic_id_id_key`(`clinic_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `services` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clinic_id` INTEGER NOT NULL,
    `name_en` VARCHAR(150) NOT NULL,
    `name_ar` VARCHAR(150) NULL,
    `description_en` TEXT NULL,
    `description_ar` TEXT NULL,
    `duration_minutes` INTEGER NOT NULL,
    `price_minor` INTEGER NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'EGP',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `services_clinic_id_name_en_key`(`clinic_id`, `name_en`),
    UNIQUE INDEX `services_clinic_id_name_ar_key`(`clinic_id`, `name_ar`),
    UNIQUE INDEX `services_clinic_id_id_key`(`clinic_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `doctor_profiles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clinic_id` INTEGER NOT NULL,
    `member_id` INTEGER NOT NULL,
    `display_name_en` VARCHAR(150) NOT NULL,
    `display_name_ar` VARCHAR(150) NULL,
    `title_en` VARCHAR(100) NULL,
    `title_ar` VARCHAR(100) NULL,
    `bio_en` TEXT NULL,
    `bio_ar` TEXT NULL,
    `years_of_experience` INTEGER NULL,
    `license_number` VARCHAR(64) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `doctor_profiles_member_id_key`(`member_id`),
    UNIQUE INDEX `doctor_profiles_clinic_id_member_id_key`(`clinic_id`, `member_id`),
    UNIQUE INDEX `doctor_profiles_clinic_id_id_key`(`clinic_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `doctor_specialties` (
    `clinic_id` INTEGER NOT NULL,
    `doctor_id` INTEGER NOT NULL,
    `specialty_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `doctor_specialties_clinic_id_specialty_id_idx`(`clinic_id`, `specialty_id`),
    PRIMARY KEY (`doctor_id`, `specialty_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `doctor_services` (
    `clinic_id` INTEGER NOT NULL,
    `doctor_id` INTEGER NOT NULL,
    `service_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `doctor_services_clinic_id_service_id_idx`(`clinic_id`, `service_id`),
    PRIMARY KEY (`doctor_id`, `service_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `working_hours` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clinic_id` INTEGER NOT NULL,
    `doctor_id` INTEGER NULL,
    `weekday` TINYINT NOT NULL,
    `start_minute` SMALLINT NOT NULL,
    `end_minute` SMALLINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `working_hours_clinic_id_doctor_id_weekday_idx`(`clinic_id`, `doctor_id`, `weekday`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `schedule_exceptions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clinic_id` INTEGER NOT NULL,
    `doctor_id` INTEGER NULL,
    `kind` ENUM('HOLIDAY', 'LEAVE', 'UNAVAILABLE') NOT NULL,
    `starts_at` DATETIME(3) NOT NULL,
    `ends_at` DATETIME(3) NOT NULL,
    `reason` VARCHAR(255) NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `schedule_exceptions_clinic_id_starts_at_idx`(`clinic_id`, `starts_at`),
    INDEX `schedule_exceptions_doctor_id_starts_at_idx`(`doctor_id`, `starts_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `specialties` ADD CONSTRAINT `specialties_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `services` ADD CONSTRAINT `services_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `doctor_profiles` ADD CONSTRAINT `doctor_profiles_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `doctor_profiles` ADD CONSTRAINT `doctor_profiles_clinic_id_member_id_fkey` FOREIGN KEY (`clinic_id`, `member_id`) REFERENCES `clinic_members`(`clinic_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `doctor_specialties` ADD CONSTRAINT `doctor_specialties_clinic_id_doctor_id_fkey` FOREIGN KEY (`clinic_id`, `doctor_id`) REFERENCES `doctor_profiles`(`clinic_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `doctor_specialties` ADD CONSTRAINT `doctor_specialties_clinic_id_specialty_id_fkey` FOREIGN KEY (`clinic_id`, `specialty_id`) REFERENCES `specialties`(`clinic_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `doctor_services` ADD CONSTRAINT `doctor_services_clinic_id_doctor_id_fkey` FOREIGN KEY (`clinic_id`, `doctor_id`) REFERENCES `doctor_profiles`(`clinic_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `doctor_services` ADD CONSTRAINT `doctor_services_clinic_id_service_id_fkey` FOREIGN KEY (`clinic_id`, `service_id`) REFERENCES `services`(`clinic_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `working_hours` ADD CONSTRAINT `working_hours_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `working_hours` ADD CONSTRAINT `working_hours_clinic_id_doctor_id_fkey` FOREIGN KEY (`clinic_id`, `doctor_id`) REFERENCES `doctor_profiles`(`clinic_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_exceptions` ADD CONSTRAINT `schedule_exceptions_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_exceptions` ADD CONSTRAINT `schedule_exceptions_clinic_id_doctor_id_fkey` FOREIGN KEY (`clinic_id`, `doctor_id`) REFERENCES `doctor_profiles`(`clinic_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- CheckConstraints (hand-written; MariaDB 10.4 enforces CHECK. Prisma does not model them.)
ALTER TABLE `services` ADD CONSTRAINT `services_duration_check` CHECK (`duration_minutes` BETWEEN 5 AND 480);
ALTER TABLE `services` ADD CONSTRAINT `services_price_check` CHECK (`price_minor` >= 0);
ALTER TABLE `doctor_profiles` ADD CONSTRAINT `doctor_profiles_experience_check` CHECK (`years_of_experience` IS NULL OR `years_of_experience` BETWEEN 0 AND 80);
ALTER TABLE `working_hours` ADD CONSTRAINT `working_hours_weekday_check` CHECK (`weekday` BETWEEN 1 AND 7);
ALTER TABLE `working_hours` ADD CONSTRAINT `working_hours_range_check` CHECK (`start_minute` >= 0 AND `end_minute` <= 1440 AND `start_minute` < `end_minute`);
ALTER TABLE `schedule_exceptions` ADD CONSTRAINT `schedule_exceptions_range_check` CHECK (`starts_at` < `ends_at`);
