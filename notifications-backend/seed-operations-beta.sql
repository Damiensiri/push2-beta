INSERT INTO spaces(slug,label,position,manual_status,liberte,longe,info,special_hours,updated_at) VALUES
  ('carriere','Carrière',1,'ouvert','non','non','','','2026-07-14T14:00:00.000Z'),
  ('manege','Manège',2,'ouvert','non','oui','','','2026-07-14T14:00:00.000Z'),
  ('maison','Maison',3,'ouvert','','','','','2026-07-14T14:00:00.000Z'),
  ('grande-voie','Grande voie',4,'ouvert','','','','','2026-07-14T14:00:00.000Z'),
  ('beudot','Beudot',5,'ouvert','','','','','2026-07-14T14:00:00.000Z')
ON CONFLICT(slug) DO NOTHING;

INSERT INTO space_schedules(space_slug,day,opens_at,closes_at) VALUES
  ('carriere',1,'08:00','21:00'),('carriere',2,'08:00','21:00'),('carriere',3,'08:00','21:00'),
  ('carriere',4,'08:00','21:00'),('carriere',5,'08:00','21:00'),('carriere',6,'07:30','20:00'),('carriere',7,'08:00','19:00'),
  ('manege',1,'08:00','21:00'),('manege',2,'08:00','21:00'),('manege',3,'08:00','21:00'),
  ('manege',4,'08:00','21:00'),('manege',5,'08:00','21:00'),('manege',6,'07:30','20:00'),('manege',7,'08:00','19:00'),
  ('maison',1,'09:00','21:00'),('maison',2,'09:00','21:00'),('maison',3,'09:00','21:00'),
  ('maison',4,'09:00','21:00'),('maison',5,'09:00','21:00'),('maison',6,'09:00','20:00'),('maison',7,'08:00','19:00'),
  ('grande-voie',1,'09:00','21:00'),('grande-voie',2,'09:00','21:00'),('grande-voie',3,'09:00','21:00'),
  ('grande-voie',4,'09:00','21:00'),('grande-voie',5,'09:00','21:00'),('grande-voie',6,'09:00','20:00'),('grande-voie',7,'08:00','19:00'),
  ('beudot',1,'09:00','21:00'),('beudot',2,'09:00','21:00'),('beudot',3,'09:00','21:00'),
  ('beudot',4,'09:00','21:00'),('beudot',5,'09:00','21:00'),('beudot',6,'09:00','20:00'),('beudot',7,'08:00','19:00')
ON CONFLICT(space_slug,day) DO NOTHING;

INSERT INTO general_schedules(day,opens_at,closes_at,updated_at) VALUES
  (1,'08:00','21:00','2026-07-14T14:00:00.000Z'),
  (2,'08:00','21:00','2026-07-14T14:00:00.000Z'),
  (3,'08:00','21:00','2026-07-14T14:00:00.000Z'),
  (4,'08:00','21:00','2026-07-14T14:00:00.000Z'),
  (5,'08:00','21:00','2026-07-14T14:00:00.000Z'),
  (6,'07:30','20:00','2026-07-14T14:00:00.000Z'),
  (7,'08:00','19:00','2026-07-14T14:00:00.000Z')
ON CONFLICT(day) DO NOTHING;

INSERT INTO home_alert(id,message,urgent,updated_at)
VALUES(1,'Vigilance Orange Canicule : adaptez votre activité !','non','2026-07-14T14:00:00.000Z')
ON CONFLICT(id) DO NOTHING;
