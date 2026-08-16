-- Add published flag for WordPress listing integration
ALTER TABLE used_cars
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false;
