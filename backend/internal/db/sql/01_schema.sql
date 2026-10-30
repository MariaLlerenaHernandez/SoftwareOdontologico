-- =====================================================================
-- SIGO-Dental · Sistema Integral de Gestión Odontológica
-- Esquema transaccional PostgreSQL (v1.0)
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------
-- Configuración global y seguridad
-- ---------------------------------------------------------------------
CREATE TABLE settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    description TEXT
);

CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    full_name       TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('admin','recepcion','odontologo','asistente','auditor')),
    specialty       TEXT,
    license_number  TEXT,
    phone           TEXT,
    color           TEXT NOT NULL DEFAULT '#0d9488',
    mfa_secret      TEXT,
    mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Log de auditoría inmutable (RNF-06)
CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id     BIGINT,
    user_email  TEXT,
    role        TEXT,
    action      TEXT NOT NULL,
    entity      TEXT NOT NULL,
    entity_id   TEXT,
    patient_id  BIGINT,
    ip          TEXT,
    user_agent  TEXT,
    method      TEXT,
    path        TEXT,
    status      INT,
    details     JSONB
);
CREATE INDEX idx_audit_time ON audit_log (occurred_at DESC);
CREATE INDEX idx_audit_patient ON audit_log (patient_id);

CREATE OR REPLACE FUNCTION fn_block_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'IMMUTABLE: los registros de % no pueden modificarse ni eliminarse', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION fn_block_mutation();

-- ---------------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------------
CREATE TABLE offices (
    id      BIGSERIAL PRIMARY KEY,
    name    TEXT NOT NULL,
    address TEXT,
    phone   TEXT,
    active  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE chairs (
    id        BIGSERIAL PRIMARY KEY,
    office_id BIGINT NOT NULL REFERENCES offices(id),
    name      TEXT NOT NULL,
    active    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE insurances (
    id           BIGSERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    coverage_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (coverage_pct BETWEEN 0 AND 100),
    phone        TEXT,
    active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE procedures (
    id                   BIGSERIAL PRIMARY KEY,
    code                 TEXT NOT NULL UNIQUE,
    name                 TEXT NOT NULL,
    category             TEXT NOT NULL,
    price                NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    lab_cost             NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (lab_cost >= 0),
    duration_min         INT NOT NULL DEFAULT 30 CHECK (duration_min > 0),
    odontogram_condition TEXT,
    active               BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------
-- Pacientes y anamnesis (RF-01, RF-02)
-- ---------------------------------------------------------------------
CREATE SEQUENCE patient_record_seq START 1001;

CREATE TABLE patients (
    id                 BIGSERIAL PRIMARY KEY,
    record_number      TEXT NOT NULL UNIQUE DEFAULT ('HC-' || nextval('patient_record_seq')),
    first_name         TEXT NOT NULL,
    last_name          TEXT NOT NULL,
    document_type      TEXT NOT NULL DEFAULT 'cedula',
    document_number    TEXT NOT NULL UNIQUE,
    birth_date         DATE NOT NULL,
    sex                TEXT NOT NULL CHECK (sex IN ('F','M','O')),
    email              TEXT,
    phone              TEXT,
    address            TEXT,
    city               TEXT,
    occupation         TEXT,
    emergency_name     TEXT,
    emergency_phone    TEXT,
    emergency_relation TEXT,
    guardian_name      TEXT,
    guardian_document  TEXT,
    guardian_phone     TEXT,
    guardian_relation  TEXT,
    insurance_id       BIGINT REFERENCES insurances(id),
    insurance_number   TEXT,
    preferred_channel  TEXT NOT NULL DEFAULT 'whatsapp' CHECK (preferred_channel IN ('whatsapp','sms','email')),
    notes              TEXT,
    active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_by         BIGINT REFERENCES users(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_patients_name ON patients (lower(last_name), lower(first_name));

CREATE TABLE medical_histories (
    patient_id          BIGINT PRIMARY KEY REFERENCES patients(id),
    systemic_diseases   TEXT,
    allergies           TEXT,
    medications         TEXT,
    surgical_history    TEXT,
    penicillin_allergy  BOOLEAN NOT NULL DEFAULT FALSE,
    latex_allergy       BOOLEAN NOT NULL DEFAULT FALSE,
    anesthesia_allergy  BOOLEAN NOT NULL DEFAULT FALSE,
    anticoagulated      BOOLEAN NOT NULL DEFAULT FALSE,
    coagulopathy        BOOLEAN NOT NULL DEFAULT FALSE,
    diabetes            BOOLEAN NOT NULL DEFAULT FALSE,
    hypertension        BOOLEAN NOT NULL DEFAULT FALSE,
    heart_disease       BOOLEAN NOT NULL DEFAULT FALSE,
    pregnant            BOOLEAN NOT NULL DEFAULT FALSE,
    smoker              BOOLEAN NOT NULL DEFAULT FALSE,
    other_conditions    TEXT,
    updated_by          BIGINT REFERENCES users(id),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vital_signs (
    id             BIGSERIAL PRIMARY KEY,
    patient_id     BIGINT NOT NULL REFERENCES patients(id),
    appointment_id BIGINT,
    systolic       INT,
    diastolic      INT,
    heart_rate     INT,
    resp_rate      INT,
    temperature    NUMERIC(4,1),
    spo2           INT,
    weight         NUMERIC(5,1),
    glucose        INT,
    notes          TEXT,
    taken_by       BIGINT REFERENCES users(id),
    taken_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE patient_files (
    id           BIGSERIAL PRIMARY KEY,
    patient_id   BIGINT NOT NULL REFERENCES patients(id),
    category     TEXT NOT NULL CHECK (category IN ('radiografia','fotografia','documento','laboratorio','otro')),
    filename     TEXT NOT NULL,
    mime_type    TEXT NOT NULL,
    size_bytes   BIGINT NOT NULL,
    storage_path TEXT NOT NULL,
    description  TEXT,
    uploaded_by  BIGINT REFERENCES users(id),
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Agenda (RF-09, RF-10, RN-03)
-- ---------------------------------------------------------------------
CREATE TABLE appointments (
    id               BIGSERIAL PRIMARY KEY,
    patient_id       BIGINT NOT NULL REFERENCES patients(id),
    dentist_id       BIGINT NOT NULL REFERENCES users(id),
    chair_id         BIGINT NOT NULL REFERENCES chairs(id),
    starts_at        TIMESTAMPTZ NOT NULL,
    ends_at          TIMESTAMPTZ NOT NULL,
    status           TEXT NOT NULL DEFAULT 'programado'
                     CHECK (status IN ('programado','confirmado','en_espera','en_atencion','atendido','cancelado','no_asistio')),
    reason           TEXT,
    notes            TEXT,
    cancel_reason    TEXT,
    reminder_48_sent BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_24_sent BOOLEAN NOT NULL DEFAULT FALSE,
    confirmed_at     TIMESTAMPTZ,
    created_by       BIGINT REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_appt_range CHECK (ends_at > starts_at),
    -- RN-03: un sillón físico no puede tener dos citas que se solapen
    CONSTRAINT excl_chair_overlap EXCLUDE USING gist (
        chair_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status NOT IN ('cancelado','no_asistio'))
);
CREATE INDEX idx_appt_start ON appointments (starts_at);
CREATE INDEX idx_appt_patient ON appointments (patient_id);

CREATE TABLE appointment_status_log (
    id             BIGSERIAL PRIMARY KEY,
    appointment_id BIGINT NOT NULL REFERENCES appointments(id),
    from_status    TEXT,
    to_status      TEXT NOT NULL,
    changed_by     BIGINT REFERENCES users(id),
    changed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notificaciones multicanal (RF-11)
CREATE TABLE notifications (
    id             BIGSERIAL PRIMARY KEY,
    patient_id     BIGINT REFERENCES patients(id),
    appointment_id BIGINT REFERENCES appointments(id),
    channel        TEXT NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
    kind           TEXT NOT NULL CHECK (kind IN ('confirmacion','recordatorio_48h','recordatorio_24h','otp','cancelacion','general')),
    recipient      TEXT NOT NULL,
    message        TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'enviado' CHECK (status IN ('pendiente','enviado','fallido')),
    provider       TEXT NOT NULL,
    provider_ref   TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_time ON notifications (created_at DESC);

-- ---------------------------------------------------------------------
-- Expediente clínico (RF-03 .. RF-06, RN-01)
-- ---------------------------------------------------------------------
CREATE TABLE treatment_plans (
    id                     BIGSERIAL PRIMARY KEY,
    patient_id             BIGINT NOT NULL REFERENCES patients(id),
    dentist_id             BIGINT NOT NULL REFERENCES users(id),
    title                  TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'borrador'
                           CHECK (status IN ('borrador','presentado','aprobado','aprobado_parcial','rechazado','completado')),
    discount_pct           NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
    discount_authorized_by BIGINT REFERENCES users(id),
    notes                  TEXT,
    approved_at            TIMESTAMPTZ,
    approved_by_name       TEXT,
    created_by             BIGINT REFERENCES users(id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE plan_items (
    id             BIGSERIAL PRIMARY KEY,
    plan_id        BIGINT NOT NULL REFERENCES treatment_plans(id),
    phase          INT NOT NULL DEFAULT 1 CHECK (phase BETWEEN 1 AND 20),
    procedure_id   BIGINT NOT NULL REFERENCES procedures(id),
    tooth          INT,
    surface        TEXT,
    description    TEXT,
    price          NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    lab_cost       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (lab_cost >= 0),
    discount_pct   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
    status         TEXT NOT NULL DEFAULT 'propuesto'
                   CHECK (status IN ('propuesto','aprobado','rechazado','agendado','realizado')),
    appointment_id BIGINT REFERENCES appointments(id),
    performed_at   TIMESTAMPTZ,
    performed_by   BIGINT REFERENCES users(id),
    invoiced       BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_plan_items_plan ON plan_items (plan_id);

CREATE TABLE odontogram_findings (
    id           BIGSERIAL PRIMARY KEY,
    patient_id   BIGINT NOT NULL REFERENCES patients(id),
    tooth        INT NOT NULL,
    surface      TEXT CHECK (surface IN ('M','D','O','V','L')),
    condition    TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'existente' CHECK (status IN ('existente','planificado','realizado')),
    notes        TEXT,
    plan_item_id BIGINT REFERENCES plan_items(id),
    created_by   BIGINT REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_odonto_patient ON odontogram_findings (patient_id);

CREATE TABLE perio_exams (
    id          BIGSERIAL PRIMARY KEY,
    patient_id  BIGINT NOT NULL REFERENCES patients(id),
    examined_by BIGINT REFERENCES users(id),
    data        JSONB NOT NULL,
    summary     JSONB,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clinical_notes (
    id             BIGSERIAL PRIMARY KEY,
    patient_id     BIGINT NOT NULL REFERENCES patients(id),
    appointment_id BIGINT REFERENCES appointments(id),
    author_id      BIGINT NOT NULL REFERENCES users(id),
    note_type      TEXT NOT NULL DEFAULT 'evolucion' CHECK (note_type IN ('evolucion','adenda')),
    parent_note_id BIGINT REFERENCES clinical_notes(id),
    subjective     TEXT,
    objective      TEXT,
    assessment     TEXT,
    plan           TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    signed_at      TIMESTAMPTZ,
    signed_by      BIGINT REFERENCES users(id),
    signature_hash TEXT
);
CREATE INDEX idx_notes_patient ON clinical_notes (patient_id, created_at DESC);

CREATE TABLE consent_templates (
    id                 BIGSERIAL PRIMARY KEY,
    title              TEXT NOT NULL,
    procedure_category TEXT,
    body               TEXT NOT NULL,
    active             BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE consents (
    id              BIGSERIAL PRIMARY KEY,
    patient_id      BIGINT NOT NULL REFERENCES patients(id),
    template_id     BIGINT REFERENCES consent_templates(id),
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','firmado','revocado')),
    method          TEXT CHECK (method IN ('firma','otp')),
    signature_data  TEXT,
    otp_hash        TEXT,
    otp_expires_at  TIMESTAMPTZ,
    signer_name     TEXT,
    signer_document TEXT,
    signed_at       TIMESTAMPTZ,
    signed_ip       TEXT,
    created_by      BIGINT REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE prescriptions (
    id          BIGSERIAL PRIMARY KEY,
    patient_id  BIGINT NOT NULL REFERENCES patients(id),
    dentist_id  BIGINT NOT NULL REFERENCES users(id),
    diagnosis   TEXT,
    items       JSONB NOT NULL,
    indications TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RN-01: lo "Realizado" no se borra; las notas firmadas/bloqueadas no se editan
CREATE OR REPLACE FUNCTION fn_protect_done() RETURNS trigger AS $$
BEGIN
    IF OLD.status = 'realizado' THEN
        RAISE EXCEPTION 'IMMUTABLE: un procedimiento realizado no puede eliminarse; registre una adenda';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_odonto_protect BEFORE DELETE ON odontogram_findings
    FOR EACH ROW EXECUTE FUNCTION fn_protect_done();
CREATE TRIGGER trg_items_protect BEFORE DELETE ON plan_items
    FOR EACH ROW EXECUTE FUNCTION fn_protect_done();

CREATE OR REPLACE FUNCTION fn_protect_done_update() RETURNS trigger AS $$
BEGIN
    IF OLD.status = 'realizado' AND (NEW.status <> 'realizado' OR NEW.tooth IS DISTINCT FROM OLD.tooth
        OR NEW.surface IS DISTINCT FROM OLD.surface) THEN
        RAISE EXCEPTION 'IMMUTABLE: un procedimiento realizado no puede modificarse; registre una adenda';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_odonto_protect_upd BEFORE UPDATE ON odontogram_findings
    FOR EACH ROW EXECUTE FUNCTION fn_protect_done_update();
CREATE TRIGGER trg_items_protect_upd BEFORE UPDATE ON plan_items
    FOR EACH ROW EXECUTE FUNCTION fn_protect_done_update();

CREATE OR REPLACE FUNCTION fn_protect_notes() RETURNS trigger AS $$
DECLARE
    lock_hours INT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'IMMUTABLE: las notas de evolución no pueden eliminarse';
    END IF;
    IF OLD.signed_at IS NOT NULL THEN
        RAISE EXCEPTION 'IMMUTABLE: la nota ya fue firmada; registre una adenda';
    END IF;
    SELECT COALESCE(value::INT, 24) INTO lock_hours FROM settings WHERE key = 'nota_bloqueo_horas';
    IF OLD.created_at < now() - make_interval(hours => COALESCE(lock_hours, 24))
       AND (NEW.subjective IS DISTINCT FROM OLD.subjective OR NEW.objective IS DISTINCT FROM OLD.objective
            OR NEW.assessment IS DISTINCT FROM OLD.assessment OR NEW.plan IS DISTINCT FROM OLD.plan) THEN
        RAISE EXCEPTION 'IMMUTABLE: el plazo de edición de la nota venció; registre una adenda';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notes_protect BEFORE UPDATE OR DELETE ON clinical_notes
    FOR EACH ROW EXECUTE FUNCTION fn_protect_notes();

CREATE TRIGGER trg_prescriptions_immutable BEFORE UPDATE OR DELETE ON prescriptions
    FOR EACH ROW EXECUTE FUNCTION fn_block_mutation();

-- ---------------------------------------------------------------------
-- Facturación, caja y honorarios (RF-12, RF-13, RN-02)
-- ---------------------------------------------------------------------
CREATE SEQUENCE invoice_number_seq START 1;

CREATE TABLE cash_sessions (
    id             BIGSERIAL PRIMARY KEY,
    user_id        BIGINT NOT NULL REFERENCES users(id),
    opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    opening_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (opening_amount >= 0),
    closed_at      TIMESTAMPTZ,
    counted_cash   NUMERIC(12,2),
    expected_cash  NUMERIC(12,2),
    difference     NUMERIC(12,2),
    notes          TEXT,
    status         TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta','cerrada'))
);
CREATE UNIQUE INDEX uq_cash_open_per_user ON cash_sessions (user_id) WHERE status = 'abierta';

CREATE TABLE invoices (
    id                   BIGSERIAL PRIMARY KEY,
    number               TEXT NOT NULL UNIQUE,
    patient_id           BIGINT NOT NULL REFERENCES patients(id),
    customer_name        TEXT NOT NULL,
    customer_document    TEXT NOT NULL,
    issued_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    subtotal             NUMERIC(12,2) NOT NULL,
    discount             NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax                  NUMERIC(12,2) NOT NULL DEFAULT 0,
    total                NUMERIC(12,2) NOT NULL,
    paid                 NUMERIC(12,2) NOT NULL DEFAULT 0,
    status               TEXT NOT NULL DEFAULT 'emitida' CHECK (status IN ('emitida','parcial','pagada','anulada')),
    electronic_status    TEXT NOT NULL DEFAULT 'pendiente' CHECK (electronic_status IN ('pendiente','autorizada','rechazada')),
    authorization_number TEXT,
    access_key           TEXT,
    issued_by            BIGINT REFERENCES users(id),
    void_reason          TEXT
);

CREATE TABLE invoice_items (
    id           BIGSERIAL PRIMARY KEY,
    invoice_id   BIGINT NOT NULL REFERENCES invoices(id),
    plan_item_id BIGINT REFERENCES plan_items(id),
    procedure_id BIGINT REFERENCES procedures(id),
    dentist_id   BIGINT REFERENCES users(id),
    description  TEXT NOT NULL,
    quantity     NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price   NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    discount     NUMERIC(12,2) NOT NULL DEFAULT 0,
    total        NUMERIC(12,2) NOT NULL
);

CREATE TABLE payments (
    id              BIGSERIAL PRIMARY KEY,
    invoice_id      BIGINT NOT NULL REFERENCES invoices(id),
    method          TEXT NOT NULL CHECK (method IN ('efectivo','tarjeta_credito','tarjeta_debito','transferencia','seguro')),
    amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    reference       TEXT,
    cash_session_id BIGINT REFERENCES cash_sessions(id),
    received_by     BIGINT REFERENCES users(id),
    paid_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE commission_rules (
    id           BIGSERIAL PRIMARY KEY,
    dentist_id   BIGINT NOT NULL REFERENCES users(id),
    procedure_id BIGINT REFERENCES procedures(id),
    rule_type    TEXT NOT NULL CHECK (rule_type IN ('porcentaje','fijo','porcentaje_neto')),
    value        NUMERIC(12,2) NOT NULL CHECK (value >= 0),
    active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE commission_settlements (
    id               BIGSERIAL PRIMARY KEY,
    dentist_id       BIGINT NOT NULL REFERENCES users(id),
    period_start     DATE NOT NULL,
    period_end       DATE NOT NULL,
    total_gross      NUMERIC(12,2) NOT NULL,
    total_commission NUMERIC(12,2) NOT NULL,
    details          JSONB NOT NULL,
    created_by       BIGINT REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Inventario (RF-14)
-- ---------------------------------------------------------------------
CREATE TABLE supplies (
    id        BIGSERIAL PRIMARY KEY,
    code      TEXT NOT NULL UNIQUE,
    name      TEXT NOT NULL,
    category  TEXT NOT NULL,
    unit      TEXT NOT NULL,
    stock     NUMERIC(12,2) NOT NULL DEFAULT 0,
    min_stock NUMERIC(12,2) NOT NULL DEFAULT 0,
    unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    office_id BIGINT REFERENCES offices(id),
    active    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE procedure_supplies (
    procedure_id BIGINT NOT NULL REFERENCES procedures(id),
    supply_id    BIGINT NOT NULL REFERENCES supplies(id),
    quantity     NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (procedure_id, supply_id)
);

CREATE TABLE stock_movements (
    id            BIGSERIAL PRIMARY KEY,
    supply_id     BIGINT NOT NULL REFERENCES supplies(id),
    movement_type TEXT NOT NULL CHECK (movement_type IN ('entrada','salida','ajuste','consumo')),
    quantity      NUMERIC(12,2) NOT NULL,
    stock_after   NUMERIC(12,2) NOT NULL,
    reason        TEXT,
    plan_item_id  BIGINT REFERENCES plan_items(id),
    office_id     BIGINT REFERENCES offices(id),
    dentist_id    BIGINT REFERENCES users(id),
    user_id       BIGINT REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mov_time ON stock_movements (created_at DESC);
