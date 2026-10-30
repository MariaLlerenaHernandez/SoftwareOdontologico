-- =====================================================================
-- SIGO-Dental · Datos de demostración
-- Los usuarios (ids 1..7) se crean desde Go con contraseñas bcrypt.
-- Las fechas son relativas al día de instalación.
-- =====================================================================

INSERT INTO settings (key, value, description) VALUES
 ('clinica_nombre',          'Clínica Odontológica Sonrisa Integral', 'Nombre comercial mostrado en documentos'),
 ('clinica_ruc',             '1790012345001',                        'Identificación tributaria del emisor'),
 ('clinica_direccion',       'Av. República 245 y Diego de Almagro',  'Dirección fiscal'),
 ('clinica_telefono',        '+593 2 255 0101',                       'Teléfono de contacto'),
 ('moneda',                  'USD',                                   'Moneda de facturación'),
 ('iva_pct',                 '0',                                     'Porcentaje de impuesto sobre servicios odontológicos'),
 ('descuento_max_pct',       '15',                                    'Descuento máximo sin autorización del administrador'),
 ('nota_bloqueo_horas',      '24',                                    'Horas tras las cuales una nota SOEP queda bloqueada'),
 ('sesion_inactividad_min',  '15',                                    'Minutos de inactividad antes del cierre automático de sesión'),
 ('mfa_obligatorio',         'false',                                 'Exigir MFA para acceder a expedientes e información financiera'),
 ('recordatorios_activos',   'true',                                  'Envío automático de recordatorios 48h/24h');

INSERT INTO offices (name, address, phone) VALUES
 ('Sede Principal', 'Av. República 245', '+593 2 255 0101'),
 ('Sede Norte',     'Av. Eloy Alfaro N45-12', '+593 2 244 0202');

INSERT INTO chairs (office_id, name) VALUES
 (1, 'Sillón 1'), (1, 'Sillón 2'), (1, 'Sillón 3'), (2, 'Sillón A'), (2, 'Sillón B');

INSERT INTO insurances (name, coverage_pct, phone) VALUES
 ('Particular (sin seguro)', 0, NULL),
 ('Salud Dental Plus', 30, '1800-725-837'),
 ('MediSeguros Premium', 50, '1800-633-473'),
 ('Convenio Empresarial Andes', 20, '+593 2 299 8800');

INSERT INTO procedures (code, name, category, price, lab_cost, duration_min, odontogram_condition) VALUES
 ('CONS-01', 'Consulta y diagnóstico',                    'Diagnóstico',   25,   0,  30, NULL),
 ('RX-01',   'Radiografía periapical',                    'Diagnóstico',   12,   0,  10, NULL),
 ('RX-02',   'Radiografía panorámica',                    'Diagnóstico',   35,   0,  15, NULL),
 ('PROF-01', 'Profilaxis y destartraje',                  'Periodoncia',   40,   0,  45, NULL),
 ('RASP-01', 'Raspado y alisado radicular (cuadrante)',   'Periodoncia',   70,   0,  60, NULL),
 ('FLUO-01', 'Aplicación de flúor',                       'Preventiva',    18,   0,  15, NULL),
 ('SELL-01', 'Sellante de fosas y fisuras (por pieza)',   'Preventiva',    20,   0,  20, 'sellante'),
 ('REST-01', 'Restauración de resina (1 superficie)',     'Operatoria',    45,   0,  40, 'restauracion'),
 ('REST-02', 'Restauración de resina (2+ superficies)',   'Operatoria',    65,   0,  60, 'restauracion'),
 ('ENDO-01', 'Endodoncia unirradicular',                  'Endodoncia',   180,   0,  90, 'endodoncia'),
 ('ENDO-02', 'Endodoncia multirradicular',                'Endodoncia',   280,   0, 120, 'endodoncia'),
 ('EXO-01',  'Exodoncia simple',                          'Cirugía',       50,   0,  30, 'exodoncia'),
 ('EXO-02',  'Exodoncia de tercer molar',                 'Cirugía',      150,   0,  60, 'exodoncia'),
 ('CORO-01', 'Corona metal-porcelana',                    'Prótesis',     350, 120,  60, 'corona'),
 ('CORO-02', 'Corona de zirconio',                        'Prótesis',     480, 180,  60, 'corona'),
 ('PROT-01', 'Prótesis removible parcial',                'Prótesis',     420, 160,  60, 'protesis_removible'),
 ('PROT-02', 'Puente fijo de 3 unidades',                 'Prótesis',     900, 330,  90, 'protesis_fija'),
 ('IMPL-01', 'Implante dental de titanio',                'Implantología',950, 300,  90, 'implante'),
 ('BLAN-01', 'Blanqueamiento dental en consultorio',      'Estética',     220,   0,  90, NULL),
 ('ORTO-01', 'Control de ortodoncia',                     'Ortodoncia',    45,   0,  30, NULL);

INSERT INTO supplies (code, name, category, unit, stock, min_stock, unit_cost, office_id) VALUES
 ('S-001', 'Resina compuesta A2 (jeringa 4 g)',     'Restauración', 'jeringa',  14,   5, 18.50, 1),
 ('S-002', 'Lidocaína 2% con epinefrina',           'Anestesia',    'carpule', 180,  50,  0.85, 1),
 ('S-003', 'Guantes de nitrilo',                    'Bioseguridad', 'par',     600, 200,  0.12, 1),
 ('S-004', 'Mascarilla quirúrgica',                 'Bioseguridad', 'unidad',  450, 150,  0.08, 1),
 ('S-005', 'Ácido grabador 37%',                    'Restauración', 'ml',       38,  10,  0.60, 1),
 ('S-006', 'Adhesivo universal',                    'Restauración', 'ml',        9,  10,  4.20, 1),
 ('S-007', 'Limas endodónticas tipo K',             'Endodoncia',   'set',      12,   4,  9.80, 1),
 ('S-008', 'Puntas de gutapercha',                  'Endodoncia',   'unidad',  240,  60,  0.15, 1),
 ('S-009', 'Hipoclorito de sodio 5.25%',            'Endodoncia',   'ml',      900, 250,  0.02, 1),
 ('S-010', 'Sutura seda 3-0',                       'Cirugía',      'sobre',    25,  10,  1.90, 1),
 ('S-011', 'Sellante de fosas y fisuras',           'Preventiva',   'ml',        6,   3,  6.50, 1),
 ('S-012', 'Pasta profiláctica',                    'Periodoncia',  'g',       320, 100,  0.05, 1),
 ('S-013', 'Gasas estériles',                       'Bioseguridad', 'unidad',  800, 200,  0.03, 1),
 ('S-014', 'Barniz de flúor (unidosis)',            'Preventiva',   'unidosis', 40,  15,  1.10, 1),
 ('S-015', 'Gel blanqueador peróxido 35%',          'Estética',     'jeringa',   3,   4, 22.00, 1),
 ('S-016', 'Eyector de saliva',                     'Bioseguridad', 'unidad',  500, 150,  0.04, 1);

-- Receta estándar de consumo por procedimiento (RF-14)
INSERT INTO procedure_supplies (procedure_id, supply_id, quantity)
SELECT p.id, s.id, x.qty FROM (VALUES
 ('CONS-01','S-003',1), ('CONS-01','S-004',1),
 ('PROF-01','S-003',1), ('PROF-01','S-004',1), ('PROF-01','S-012',5), ('PROF-01','S-016',1),
 ('RASP-01','S-003',2), ('RASP-01','S-002',1), ('RASP-01','S-013',4), ('RASP-01','S-016',1),
 ('FLUO-01','S-003',1), ('FLUO-01','S-014',1),
 ('SELL-01','S-003',1), ('SELL-01','S-011',0.2), ('SELL-01','S-005',0.2),
 ('REST-01','S-001',0.25), ('REST-01','S-002',1), ('REST-01','S-003',2), ('REST-01','S-005',0.5), ('REST-01','S-006',0.2), ('REST-01','S-016',1),
 ('REST-02','S-001',0.5),  ('REST-02','S-002',2), ('REST-02','S-003',2), ('REST-02','S-005',0.8), ('REST-02','S-006',0.3), ('REST-02','S-016',1),
 ('ENDO-01','S-002',2), ('ENDO-01','S-003',2), ('ENDO-01','S-007',0.5), ('ENDO-01','S-008',4), ('ENDO-01','S-009',20),
 ('ENDO-02','S-002',3), ('ENDO-02','S-003',3), ('ENDO-02','S-007',1),   ('ENDO-02','S-008',10), ('ENDO-02','S-009',40),
 ('EXO-01','S-002',2), ('EXO-01','S-003',2), ('EXO-01','S-013',6), ('EXO-01','S-010',1),
 ('EXO-02','S-002',4), ('EXO-02','S-003',3), ('EXO-02','S-013',10), ('EXO-02','S-010',2),
 ('BLAN-01','S-015',1), ('BLAN-01','S-003',2)
) AS x(pcode, scode, qty)
JOIN procedures p ON p.code = x.pcode
JOIN supplies s ON s.code = x.scode;

INSERT INTO patients (first_name, last_name, document_number, birth_date, sex, email, phone, address, city, occupation,
                      emergency_name, emergency_phone, emergency_relation, guardian_name, guardian_document, guardian_phone, guardian_relation,
                      insurance_id, insurance_number, preferred_channel, created_by) VALUES
 ('María José', 'Andrade López',    '1712345678', '1988-04-12', 'F', 'mariajose.andrade@correo.com', '+593 99 123 4567', 'Av. 6 de Diciembre N32-45', 'Quito', 'Arquitecta',
  'Pablo Andrade', '+593 98 765 4321', 'Esposo', NULL, NULL, NULL, NULL, 2, 'SDP-558201', 'whatsapp', 2),
 ('Juan Carlos', 'Pérez Villacís',  '1709876543', '1975-09-30', 'M', 'jc.perez@correo.com',          '+593 98 222 3344', 'Calle Los Pinos 120',      'Quito', 'Contador',
  'Ana Villacís', '+593 99 888 1122', 'Hermana', NULL, NULL, NULL, NULL, 3, 'MSP-993012', 'sms', 2),
 ('Sofía',       'Benítez Ruiz',    '1754321098', '2015-02-18', 'F', NULL,                           '+593 97 555 6677', 'Conjunto Las Acacias, casa 8', 'Quito', 'Estudiante',
  'Rosa Ruiz', '+593 97 555 6677', 'Madre', 'Rosa Ruiz Mora', '1711122233', '+593 97 555 6677', 'Madre', 1, NULL, 'whatsapp', 2),
 ('Luis Alberto','Guerrero Paz',    '1702233445', '1958-11-03', 'M', 'luis.guerrero@correo.com',     '+593 96 101 2020', 'Av. América N25-10',       'Quito', 'Jubilado',
  'Carmen Paz', '+593 96 303 4040', 'Esposa', NULL, NULL, NULL, NULL, 3, 'MSP-118833', 'whatsapp', 2),
 ('Daniela',     'Morales Cevallos','1722334455', '1995-06-21', 'F', 'dani.morales@correo.com',      '+593 99 444 5566', 'Calle Japón E4-88',        'Quito', 'Diseñadora gráfica',
  'Fernando Morales', '+593 99 111 0000', 'Padre', NULL, NULL, NULL, NULL, 1, NULL, 'email', 2),
 ('Andrés',      'Salazar Mena',    '1733445566', '1982-01-15', 'M', 'andres.salazar@correo.com',    '+593 98 777 8899', 'Av. Shyris N40-22',        'Quito', 'Ingeniero civil',
  'Lucía Mena', '+593 98 777 0001', 'Madre', NULL, NULL, NULL, NULL, 4, 'CEA-44120', 'whatsapp', 2),
 ('Gabriela',    'Torres Jaramillo','1744556677', '1990-08-08', 'F', 'gaby.torres@correo.com',       '+593 97 222 1100', 'Urb. El Condado, mz 4',    'Quito', 'Abogada',
  'Diego Jaramillo', '+593 97 222 1101', 'Esposo', NULL, NULL, NULL, NULL, 2, 'SDP-330981', 'whatsapp', 2),
 ('Mateo',       'Herrera Castro',  '1755667788', '2012-12-01', 'M', NULL,                           '+593 96 999 1234', 'Calle Rumipamba 45',       'Quito', 'Estudiante',
  'Paola Castro', '+593 96 999 1234', 'Madre', 'Paola Castro Rivas', '1716655443', '+593 96 999 1234', 'Madre', 4, 'CEA-44121', 'sms', 2),
 ('Rosa Elena',  'Chávez Ortiz',    '1700112233', '1965-03-27', 'F', 'rosa.chavez@correo.com',       '+593 95 123 9876', 'Av. Mariscal Sucre S12-30', 'Quito', 'Comerciante',
  'Jorge Chávez', '+593 95 123 0000', 'Hijo', NULL, NULL, NULL, NULL, 1, NULL, 'whatsapp', 2),
 ('Fernando',    'Ríos Valencia',   '1766778899', '1979-07-19', 'M', 'fernando.rios@correo.com',     '+593 99 321 6540', 'Calle Whymper N28-15',     'Quito', 'Médico',
  'Patricia Valencia', '+593 99 321 0001', 'Esposa', NULL, NULL, NULL, NULL, 3, 'MSP-772210', 'email', 2),
 ('Valentina',   'Ortega Silva',    '1777889900', '2001-10-05', 'F', 'vale.ortega@correo.com',       '+593 98 654 3210', 'Av. Colón E8-50',          'Quito', 'Estudiante universitaria',
  'Marta Silva', '+593 98 654 0000', 'Madre', NULL, NULL, NULL, NULL, 1, NULL, 'whatsapp', 2),
 ('Ricardo',     'Navarrete Lema',  '1788990011', '1970-05-14', 'M', 'r.navarrete@correo.com',       '+593 97 111 2233', 'Av. Occidental N50-90',    'Quito', 'Chofer profesional',
  'Elena Lema', '+593 97 111 0000', 'Esposa', NULL, NULL, NULL, NULL, 2, 'SDP-901122', 'sms', 2);

INSERT INTO medical_histories (patient_id, systemic_diseases, allergies, medications, surgical_history,
    penicillin_allergy, latex_allergy, anesthesia_allergy, anticoagulated, coagulopathy, diabetes, hypertension, heart_disease, pregnant, smoker, other_conditions, updated_by) VALUES
 (1,  'Ninguna conocida', 'Penicilina (urticaria generalizada)', 'Anticonceptivos orales', 'Apendicectomía (2010)', TRUE,  FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, NULL, 3),
 (2,  'Hipertensión arterial controlada', NULL, 'Losartán 50 mg c/24h', NULL,                              FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, TRUE,  NULL, 3),
 (3,  NULL, NULL, NULL, NULL,                                                                              FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'Paciente pediátrica, buena colaboración', 3),
 (4,  'Fibrilación auricular, diabetes tipo 2', 'Látex', 'Warfarina 5 mg, Metformina 850 mg', 'Bypass coronario (2018)', FALSE, TRUE, FALSE, TRUE, FALSE, TRUE, TRUE, TRUE, FALSE, FALSE, 'Solicitar INR previo a procedimientos quirúrgicos', 4),
 (5,  NULL, NULL, NULL, NULL,                                                                              FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE,  FALSE, 'Embarazo de 20 semanas', 3),
 (6,  NULL, NULL, NULL, 'Rinoplastia (2015)',                                                              FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE,  NULL, 4),
 (7,  'Hipotiroidismo', 'Ibuprofeno', 'Levotiroxina 75 mcg', NULL,                                          FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, NULL, 3),
 (8,  NULL, NULL, NULL, NULL,                                                                              FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'Tratamiento de ortodoncia activo', 5),
 (9,  'Hemofilia tipo A leve', NULL, NULL, NULL,                                                           FALSE, FALSE, FALSE, FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, FALSE, 'Coordinar con hematología', 4),
 (10, NULL, NULL, NULL, NULL,                                                                              FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, NULL, 3),
 (11, NULL, 'Articaína', NULL, NULL,                                                                       FALSE, FALSE, TRUE,  FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, NULL, 5),
 (12, 'Diabetes tipo 2', NULL, 'Metformina 1 g c/12h', NULL,                                               FALSE, FALSE, FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, FALSE, TRUE,  NULL, 4);

-- Odontograma inicial
INSERT INTO odontogram_findings (patient_id, tooth, surface, condition, status, notes, created_by) VALUES
 (1, 16, 'O', 'caries',       'existente', 'Caries oclusal profunda', 3),
 (1, 16, 'M', 'caries',       'existente', NULL, 3),
 (1, 26, 'O', 'restauracion', 'existente', 'Amalgama antigua', 3),
 (1, 36, NULL,'endodoncia',   'existente', 'Endodoncia previa (2019)', 3),
 (1, 36, NULL,'corona',       'existente', NULL, 3),
 (1, 46, NULL,'ausente',      'existente', 'Pérdida por caries', 3),
 (1, 11, 'V', 'restauracion', 'existente', NULL, 3),
 (1, 47, 'O', 'caries',       'existente', NULL, 3),
 (2, 18, NULL,'exodoncia',    'planificado', 'Tercer molar semi-incluido', 4),
 (2, 25, 'D', 'caries',       'existente', NULL, 4),
 (2, 37, NULL,'implante',     'existente', NULL, 4),
 (4, 14, NULL,'protesis_fija','existente', 'Puente 14-16', 4),
 (4, 15, NULL,'ausente',      'existente', 'Póntico', 4),
 (4, 16, NULL,'protesis_fija','existente', NULL, 4);

-- Plan de tratamiento de ejemplo (RF-07/RF-08)
INSERT INTO treatment_plans (patient_id, dentist_id, title, status, discount_pct, notes, approved_at, approved_by_name, created_by, created_at) VALUES
 (1, 3, 'Rehabilitación integral sector posterior', 'aprobado_parcial', 5, 'Paciente prioriza fase 1 por cobertura del seguro', now() - interval '6 days', 'María José Andrade López', 3, now() - interval '7 days'),
 (2, 4, 'Cirugía de tercer molar y operatoria',     'presentado',       0, NULL, NULL, NULL, 4, now() - interval '2 days');

INSERT INTO plan_items (plan_id, phase, procedure_id, tooth, surface, description, price, lab_cost, discount_pct, status, performed_at, performed_by) VALUES
 (1, 1, (SELECT id FROM procedures WHERE code='PROF-01'), NULL, NULL, 'Profilaxis inicial',              40,   0, 0, 'realizado', now() - interval '5 days', 3),
 (1, 1, (SELECT id FROM procedures WHERE code='REST-02'), 16,  'O',  'Resina OM pieza 16',              65,   0, 0, 'aprobado',  NULL, NULL),
 (1, 1, (SELECT id FROM procedures WHERE code='REST-01'), 47,  'O',  'Resina oclusal pieza 47',         45,   0, 0, 'aprobado',  NULL, NULL),
 (1, 2, (SELECT id FROM procedures WHERE code='IMPL-01'), 46,  NULL, 'Implante para reponer pieza 46',  950, 300, 0, 'rechazado', NULL, NULL),
 (1, 2, (SELECT id FROM procedures WHERE code='CORO-02'), 46,  NULL, 'Corona de zirconio sobre implante',480, 180, 0, 'rechazado', NULL, NULL),
 (2, 1, (SELECT id FROM procedures WHERE code='RX-02'),   NULL, NULL, 'Panorámica prequirúrgica',        35,   0, 0, 'propuesto', NULL, NULL),
 (2, 1, (SELECT id FROM procedures WHERE code='EXO-02'),  18,  NULL, 'Exodoncia 18',                    150,  0, 0, 'propuesto', NULL, NULL),
 (2, 2, (SELECT id FROM procedures WHERE code='REST-01'), 25,  'D',  'Resina distal 25',                45,   0, 0, 'propuesto', NULL, NULL);

-- Notas SOEP (una firmada, otra en borrador)
INSERT INTO clinical_notes (patient_id, author_id, subjective, objective, assessment, plan, created_at, updated_at) VALUES
 (1, 3, 'Paciente refiere sensibilidad al frío en molar superior derecho desde hace 2 semanas.',
        'Caries oclusal y mesial en 16, sin dolor a la percusión. Encías con inflamación leve generalizada.',
        'Caries dentinaria 16 (CIE-10 K02.1). Gingivitis asociada a placa.',
        'Profilaxis. Restauración de resina OM en 16. Control en 6 meses.', now() - interval '7 days', now() - interval '7 days'),
 (1, 3, 'Acude a profilaxis programada. Sin molestias.',
        'Placa bacteriana moderada, cálculo supragingival en sector anteroinferior.',
        'Gingivitis en resolución.',
        'Se realiza profilaxis y destartraje. Refuerzo de técnica de cepillado.', now() - interval '5 days', now() - interval '5 days');

UPDATE clinical_notes SET signed_at = created_at + interval '1 hour', signed_by = author_id,
       signature_hash = encode(sha256(convert_to(id::text || '|' || author_id::text || '|' || coalesce(subjective,'') || coalesce(objective,'') || coalesce(assessment,'') || coalesce(plan,''), 'UTF8')), 'hex');

INSERT INTO consent_templates (title, procedure_category, body) VALUES
 ('Consentimiento para exodoncia', 'Cirugía',
  'Yo, {{paciente}}, con documento {{documento}}, autorizo al profesional {{odontologo}} a realizar la extracción de la(s) pieza(s) indicada(s). He sido informado(a) de los riesgos: dolor, inflamación, sangrado, infección, alveolitis, lesión de piezas vecinas, parestesia temporal o permanente y comunicación oroantral. Me comprometo a seguir las indicaciones postoperatorias. Declaro haber informado mis antecedentes médicos de forma veraz.'),
 ('Consentimiento para endodoncia', 'Endodoncia',
  'Yo, {{paciente}}, con documento {{documento}}, autorizo al profesional {{odontologo}} a realizar el tratamiento de conductos. Comprendo que el tratamiento tiene un alto porcentaje de éxito pero puede requerir retratamiento, cirugía apical o extracción. Riesgos: fractura de instrumentos, perforación, dolor postoperatorio y fractura dental si no se rehabilita la pieza.'),
 ('Consentimiento para anestesia local', 'General',
  'Yo, {{paciente}}, con documento {{documento}}, autorizo la aplicación de anestesia local. He sido informado(a) de posibles efectos: hematoma, parestesia transitoria, reacción alérgica, taquicardia y mordedura accidental de tejidos blandos mientras dura el efecto.'),
 ('Consentimiento para implante dental', 'Implantología',
  'Yo, {{paciente}}, con documento {{documento}}, autorizo al profesional {{odontologo}} a la colocación de implante(s) dental(es). Comprendo que la oseointegración no está garantizada, que el tabaquismo y enfermedades sistémicas aumentan el riesgo de fracaso, y que pueden requerirse injertos óseos. Riesgos: infección, lesión nerviosa, sinusitis y pérdida del implante.'),
 ('Consentimiento para blanqueamiento dental', 'Estética',
  'Yo, {{paciente}}, con documento {{documento}}, autorizo el tratamiento de blanqueamiento dental. Entiendo que los resultados varían, que puede presentarse sensibilidad transitoria y que las restauraciones existentes no cambian de color.');

INSERT INTO commission_rules (dentist_id, procedure_id, rule_type, value) VALUES
 (3, NULL, 'porcentaje', 40),
 (4, NULL, 'porcentaje_neto', 50),
 (5, NULL, 'porcentaje', 35),
 (5, (SELECT id FROM procedures WHERE code='ORTO-01'), 'fijo', 15);

INSERT INTO prescriptions (patient_id, dentist_id, diagnosis, items, indications, created_at) VALUES
 (2, 4, 'Pericoronaritis pieza 48',
  '[{"medicamento":"Amoxicilina 500 mg","dosis":"1 cápsula","frecuencia":"cada 8 horas","duracion":"7 días"},{"medicamento":"Ibuprofeno 400 mg","dosis":"1 tableta","frecuencia":"cada 8 horas","duracion":"3 días"}]',
  'Enjuagues con clorhexidina 0.12% dos veces al día. Dieta blanda.', now() - interval '3 days');

INSERT INTO vital_signs (patient_id, systolic, diastolic, heart_rate, resp_rate, temperature, spo2, weight, taken_by, taken_at) VALUES
 (1, 118, 76, 72, 16, 36.5, 98, 61.0, 6, now() - interval '5 days'),
 (2, 138, 88, 80, 17, 36.7, 97, 84.5, 6, now() - interval '3 days'),
 (4, 142, 90, 88, 18, 36.6, 96, 79.0, 6, now() - interval '10 days');

-- ---------------------------------------------------------------------
-- Historial operativo de los últimos 60 días (citas, facturas, caja)
-- ---------------------------------------------------------------------
DO $$
DECLARE
    d       DATE;
    c       INT;
    n       INT;
    i       INT;
    st      TEXT;
    pid     BIGINT;
    did     BIGINT;
    proc    RECORD;
    aid     BIGINT;
    inv     BIGINT;
    sess    BIGINT;
    t       TIMESTAMPTZ;
    r       FLOAT;
    m       TEXT;
    num     BIGINT;
    methods TEXT[] := ARRAY['efectivo','tarjeta_credito','tarjeta_debito','transferencia','efectivo'];
BEGIN
    PERFORM setseed(0.42);
    FOR d IN SELECT generate_series(current_date - 60, current_date - 1, interval '1 day')::date LOOP
        CONTINUE WHEN extract(dow FROM d) = 0;
        INSERT INTO cash_sessions (user_id, opened_at, opening_amount, status)
        VALUES (2, d + time '08:00', 50, 'abierta') RETURNING id INTO sess;

        FOR c IN 1..4 LOOP
            n := 1 + floor(random() * 3)::int;
            FOR i IN 1..n LOOP
                t := d + time '08:00' + make_interval(hours => (i - 1) * 3 + (c % 2));
                pid := 1 + floor(random() * 12)::int;
                did := 3 + floor(random() * 3)::int;
                r := random();
                st := CASE WHEN r < 0.82 THEN 'atendido' WHEN r < 0.92 THEN 'no_asistio' ELSE 'cancelado' END;
                SELECT * INTO proc FROM procedures
                 WHERE code = ANY (ARRAY['CONS-01','PROF-01','REST-01','REST-02','ENDO-01','EXO-01','RX-02','FLUO-01','SELL-01','ORTO-01','BLAN-01','CORO-01','RASP-01'])
                 ORDER BY random() LIMIT 1;

                INSERT INTO appointments (patient_id, dentist_id, chair_id, starts_at, ends_at, status, reason,
                                          reminder_48_sent, reminder_24_sent, created_by, created_at)
                VALUES (pid, did, c, t, t + make_interval(mins => LEAST(proc.duration_min, 90)), st, proc.name, TRUE, TRUE, 2, t - interval '5 days')
                RETURNING id INTO aid;

                IF st = 'atendido' THEN
                    num := nextval('invoice_number_seq');
                    INSERT INTO invoices (number, patient_id, customer_name, customer_document, issued_at, subtotal, total, paid,
                                          status, electronic_status, authorization_number, access_key, issued_by)
                    SELECT '001-001-' || lpad(num::text, 9, '0'), p.id, p.first_name || ' ' || p.last_name, p.document_number,
                           t + interval '100 min', proc.price, proc.price, proc.price, 'pagada', 'autorizada',
                           'AUT-' || upper(substr(md5(random()::text), 1, 16)),
                           to_char(d, 'DDMMYYYY') || '01' || '1790012345001' || '2' || '001001' || lpad(num::text, 9, '0') || lpad((floor(random() * 99999999))::bigint::text, 8, '0') || '1', 2
                      FROM patients p WHERE p.id = pid
                    RETURNING id INTO inv;

                    INSERT INTO invoice_items (invoice_id, procedure_id, dentist_id, description, quantity, unit_price, total)
                    VALUES (inv, proc.id, did, proc.name, 1, proc.price, proc.price);

                    m := methods[1 + floor(random() * 5)::int];
                    INSERT INTO payments (invoice_id, method, amount, reference, cash_session_id, received_by, paid_at)
                    VALUES (inv, m, proc.price, CASE WHEN m <> 'efectivo' THEN 'REF-' || (100000 + floor(random() * 899999))::int END,
                            CASE WHEN m = 'efectivo' THEN sess END, 2, t + interval '105 min');
                END IF;
            END LOOP;
        END LOOP;

        UPDATE cash_sessions
           SET closed_at = d + time '19:00',
               expected_cash = opening_amount + COALESCE((SELECT sum(amount) FROM payments WHERE cash_session_id = sess), 0),
               status = 'cerrada'
         WHERE id = sess;
        UPDATE cash_sessions
           SET counted_cash = expected_cash + CASE WHEN random() < 0.15 THEN -5 WHEN random() < 0.05 THEN 2 ELSE 0 END
         WHERE id = sess;
        UPDATE cash_sessions SET difference = counted_cash - expected_cash WHERE id = sess;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Agenda de hoy y próximos días
-- ---------------------------------------------------------------------
INSERT INTO appointments (patient_id, dentist_id, chair_id, starts_at, ends_at, status, reason, confirmed_at, created_by) VALUES
 (1, 3, 1, current_date + time '08:30', current_date + time '09:30', 'atendido',    'Restauración pieza 16',        now() - interval '1 day', 2),
 (7, 3, 1, current_date + time '10:00', current_date + time '10:45', 'en_atencion', 'Profilaxis',                   now() - interval '1 day', 2),
 (4, 4, 2, current_date + time '09:00', current_date + time '10:30', 'en_espera',   'Control de prótesis fija',     now() - interval '1 day', 2),
 (9, 4, 2, current_date + time '11:00', current_date + time '12:00', 'confirmado',  'Valoración periodontal',       now() - interval '2 hours', 2),
 (8, 5, 3, current_date + time '09:30', current_date + time '10:00', 'confirmado',  'Control de ortodoncia',        now() - interval '1 day', 2),
 (3, 5, 3, current_date + time '15:00', current_date + time '15:30', 'programado',  'Sellantes molares permanentes', NULL, 2),
 (6, 3, 4, current_date + time '14:00', current_date + time '15:00', 'programado',  'Diagnóstico y panorámica',     NULL, 2),
 (11,5, 5, current_date + time '16:00', current_date + time '16:45', 'programado',  'Blanqueamiento (valoración)',  NULL, 2),
 (2, 4, 1, current_date + 1 + time '09:00', current_date + 1 + time '10:00', 'programado', 'Exodoncia pieza 18', NULL, 2),
 (5, 3, 2, current_date + 1 + time '10:30', current_date + 1 + time '11:15', 'confirmado', 'Profilaxis (embarazo 2do trimestre)', now(), 2),
 (10,3, 1, current_date + 1 + time '15:00', current_date + 1 + time '16:00', 'programado', 'Restauración estética', NULL, 2),
 (12,4, 4, current_date + 2 + time '08:30', current_date + 2 + time '10:00', 'programado', 'Endodoncia pieza 36', NULL, 2),
 (1, 3, 1, current_date + 2 + time '11:00', current_date + 2 + time '11:40', 'programado', 'Resina pieza 47', NULL, 2),
 (8, 5, 3, current_date + 3 + time '09:00', current_date + 3 + time '09:30', 'programado', 'Control de ortodoncia', NULL, 2),
 (7, 4, 2, current_date + 4 + time '16:00', current_date + 4 + time '17:00', 'programado', 'Raspado y alisado radicular', NULL, 2);

UPDATE plan_items SET status = 'agendado',
       appointment_id = (SELECT id FROM appointments WHERE patient_id = 1 AND reason = 'Resina pieza 47' LIMIT 1)
 WHERE plan_id = 1 AND tooth = 47;

INSERT INTO notifications (patient_id, appointment_id, channel, kind, recipient, message, provider, provider_ref, created_at)
SELECT a.patient_id, a.id, p.preferred_channel, 'confirmacion',
       CASE WHEN p.preferred_channel = 'email' THEN coalesce(p.email, p.phone) ELSE p.phone END,
       'Hola ' || split_part(p.first_name, ' ', 1) || ', su cita en Clínica Sonrisa Integral quedó agendada para el ' ||
       to_char(a.starts_at, 'DD/MM/YYYY "a las" HH24:MI') || '. Responda SI para confirmar.',
       CASE p.preferred_channel WHEN 'whatsapp' THEN 'meta-cloud-api (simulado)' WHEN 'sms' THEN 'twilio-sms (simulado)' ELSE 'twilio-sendgrid (simulado)' END,
       'SIM-' || a.id, a.created_at
  FROM appointments a JOIN patients p ON p.id = a.patient_id
 WHERE a.starts_at >= current_date;

-- Fechas de alta escalonadas para que los indicadores mensuales sean realistas
UPDATE patients SET created_at = now() - make_interval(days => (400 - id * 29)::int), updated_at = now() - make_interval(days => (400 - id * 29)::int);
UPDATE patients SET created_at = now() - interval '6 days' WHERE id IN (11, 12);
