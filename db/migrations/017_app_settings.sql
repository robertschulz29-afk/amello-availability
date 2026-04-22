CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_settings (key, value, updated_at)
VALUES (
  'booking_com_cookies',
  $$bkng=11UmFuZG9tSVYkc2RlIyh9Yaa29%2F3xUOLbaxYXEzBEjstZIjfUFq0eXawMtr1fb4zM%2FySPiBX2VF38j81n1RuCahikzRByCy%2B3goeX510BO5%2Bey4DY8EhlByFwVuBhl3IzpWc2x1Ek1z7k2BVNCTKukivIZyHh3AL9tYquNtuMEKx4hSSfTiUoSL30YEYEUVucx3HrxN22E%2BxXBd5fDA9%2FWoTzj%2FQcDJ0Y3wpkoQ4iEwDa38WS%2F8ortg%3D%3D; bkng_sso_auth=CAIQi4nT0gIahwEGAi4McSTZ0TFKuZlNoCqv+luXRXEtucJIYefFiP8TAbsf4Eg5qqyxg22FJYvdOstrYySv70Hm/HHz1QpqzXmqQc4t51TRjHVK5Lvc3W919Vq4vSsqoZkWySA+50OTv5l/aEM/YyQrQHWipeSlT4GFFoDTi8shW057bQMTdAcvNTwhA9id52A=; bkng_sso_session=eyJib29raW5nX2dsb2JhbCI6W3sibG9naW5faGludCI6ImI3KzNFNndLVXR0SzEwNEkxekpmdktqV2Rtei9RMmtOak9hTkprL0I2b0UifV19; bkng_sso_ses=eyJib29raW5nX2dsb2JhbCI6W3siaCI6ImI3KzNFNndLVXR0SzEwNEkxekpmdktqV2Rtei9RMmtOak9hTkprL0I2b0UifV19; pcm_consent=consentedAt%3D2026-04-21T17%3A43%3A10.444Z%26countryCode%3DDE%26expiresAt%3D2026-10-18T17%3A43%3A10.444Z%26implicit%3Dfalse%26regionCode%3DSN%26regulation%3Dgdpr%26legacyRegulation%3Dgdpr%26consentId%3D273ea6a8-9191-48ce-bc9c-22ca15c87e4a%26analytical%3Dtrue%26marketing%3Dtrue; aws-waf-token=45734220-1537-43bb-93e6-d666fd82fa57:CQoAr6d8e0gNAAAA:HEtG4lnoQ++xH1dW7Bw6az6LZ314Syt6aSS0l+EYsslt6tAplTKEh2wUJGPsjURmfjq16Jh3QsigJdD/cXvZUNLwLOIw5Uxhjnn+PRCrTW1YdUMQQiWYgr9rW3x0dnus/U+F36f+41MMy7xK/BzfpEx096C+GxmBrqA2v3C1IHw5t5jr2y9qvsWgCWAu9x3bpZruulpjgHCq0KbNJ6Ef05LJ07dT695n9BvVWPrO5+OzIMKHAF0VU/xTktOH+Wg=$$,
  NOW()
)
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = NOW();
