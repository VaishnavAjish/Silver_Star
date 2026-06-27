-- Phase 43: Company Reporting Preferences

CREATE TABLE IF NOT EXISTS company_reporting_preferences (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE,
    base_currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    reporting_currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    reporting_exchange_rate NUMERIC(15, 6) NOT NULL DEFAULT 85.000000,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    display_currency VARCHAR(10) NOT NULL DEFAULT 'INR', -- 'INR', 'USD', 'BOTH'
    number_format VARCHAR(20) NOT NULL DEFAULT 'INDIAN', -- 'INDIAN', 'INTERNATIONAL'
    decimal_precision INT NOT NULL DEFAULT 2,
    negative_number_style VARCHAR(20) NOT NULL DEFAULT 'ACCOUNTING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT company_reporting_preferences_singleton CHECK (id)
);

-- Insert the default preferences
INSERT INTO company_reporting_preferences (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_company_reporting_preferences_modtime ON company_reporting_preferences;
CREATE TRIGGER update_company_reporting_preferences_modtime
    BEFORE UPDATE ON company_reporting_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
