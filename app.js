'use strict';
/* BUILT (früher Hantelbuch) – Trainings-App für Manu & Rob.
   Alles, was passiert (Training, Skip, Planänderung, Tausch, Körpergewicht, Profilbild), wird als Eintrag in einem Log gespeichert:
   zuerst auf dem Handy, beim Sync in der Google-Tabelle. Der aktuelle Stand wird immer aus dem Log berechnet.
   Ausnahme: der Vault. Seine Bilder bleiben verschlüsselt nur auf diesem Handy und werden nie synchronisiert. */

const APP_VERSION = '3.2.0';
const SCRIPT_MIN = 0;            // Google-Skript entfällt ab 3.0
/* Supabase: Projekt in Frankfurt. Der Publishable Key ist öffentlich, Zugriff regeln die Zeilenrechte in der Datenbank. */
const SB_URL = (() => { try { return localStorage.getItem('built.sb.url') || 'https://orfbfukamifoqpnpdckb.supabase.co'; } catch (e) { return 'https://orfbfukamifoqpnpdckb.supabase.co'; } })();
const V3_CHAT = true;
const SB_KEY = 'sb_publishable_lRri8xqx8PzRR81-ZfarBg_sRJO9TSo';
const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'built.auth' } });
/* Personen: ich, dann meine Crew, dann Freunde. Kennung ist die Profil-ID, angezeigt wird der Name. */
let PROFILES = (() => { try { return JSON.parse(localStorage.getItem('hb.profiles') || '{}'); } catch (e) { return {}; } })();
let CREW = (() => { try { return JSON.parse(localStorage.getItem('hb.crew') || 'null'); } catch (e) { return null; } })();
let PEOPLE = [];
function computePeople() {
  const me = (() => { try { return (JSON.parse(localStorage.getItem('hb.cfg') || '{}') || {}).me; } catch (e) { return null; } })();
  const crew = CREW && Array.isArray(CREW.members) ? CREW.members : [];
  const friends = Object.values(PROFILES).filter(p => p.friend).map(p => p.id);
  PEOPLE = [...new Set([me, ...crew, ...friends].filter(Boolean))];
}
computePeople();
const pname = p => (typeof p === 'string' && p.startsWith('crew:') ? (CREW && CREW.name) || 'Crew' : (PROFILES[p] && PROFILES[p].name) || (p && p.length < 20 ? p : 'Buddy'));
const crewKey = () => (CREW && CREW.id ? 'crew:' + CREW.id : null);
const isCrewKey = p => typeof p === 'string' && p.startsWith('crew:');
const nm = p => esc(pname(p));
const DAYS = ['A', 'B', 'C', 'D', 'E', 'F'];    // interne Kennung der Trainingstage (bis zu 6 pro Plan), angezeigt werden die Kürzel
const DAY_SHORT = { A: 'B&T', B: 'R&B', C: 'B&B', D: 'T4', E: 'T5', F: 'T6' };
const DAY_TONE = { A: 'y', B: 'm', C: 'c', D: 'g', E: 'r', F: 'v' };   // Gelb, Magenta, Cyan, dann die Mischfarben Grün, Rot, Violett
const EMPTY_DAY = { title: '', short: '', exercises: [] };
// Pläne: „crew“ = Crew-Plan (Änderungen gehen als Vorschlag an die Crew), „mine“ = Mein Plan (nur für mich)
const PD = pl => DAYS.filter(d => pl && pl[d]);   // vorhandene Tage eines Plans in fester Reihenfolge
const TYPE_LABEL = { kg: 'Gewicht', bw: 'Körpergewicht', time: 'Zeit', tr: 'Zeit + Wdh.' };
const isTimed = type => type === 'time' || type === 'tr';   // Übungen mit Timer
const REM_WHY = { zeit: 'Zeit', geraet: 'Gerät belegt', erschoepft: 'Erschöpft', schmerz: 'Schmerzen' };   // Grund für − Satz
const ADD_WHY = { b: 'Bonus', r: 'Wiederholung' };   // Grund für + Satz
const REGEN_H = 48;   // empfohlene Regeneration zwischen zwei gleichen Trainingstagen in Stunden
const WARMUP_DEFAULT = new Set(['bankdruecken', 'lh-rudern', 'kniebeugen', 'rdl']);
const WARMUP = [0.6, 6];         // ein Aufwärmsatz: 60 % × 6
const FEEL = { leicht: 'Leicht', passt: 'Passt', schwer: 'Schwer' };   // alte Bewertung pro Übung (bis 1.5)
const SET_FEEL = { locker: 'Locker', passt: 'Passt', limit: 'Am Limit' };  // Bewertung pro Satz (ab 1.6)
const RIR = { locker: 3, passt: 1.5, limit: 0 };  // geschätzte Wiederholungen im Tank, für die Maximalkraft-Schätzung
const LIB_MIN_SCRIPT = 5;          // ab dieser Skript-Version liegt die Bibliothek als Blatt in der Tabelle
const OLD_PRESETS = [{ name: 'Dips, Klimmzüge', pct: 100 }, { name: 'Liegestütze', pct: 65 }, { name: 'Knie-Liegestütze', pct: 50 }, { name: 'Beinheben', pct: 35 }, { name: 'Nur Wiederholungen', pct: 0 }];
const PAUSE_DAYS = 21;
const DELOAD_WEEKS = 8;
const DELOAD_WEEKS_PLATEAU = 4;

function ex(id, name, type, sets, min, max, step, cue) {
  return { id, name, type, sets, min, max, step, cue, video: '', image: '', warmup: WARMUP_DEFAULT.has(id), personal: false };
}
const DEFAULT_PLAN = {
  A: { title: 'Brust & Trizeps', short: 'B&T', exercises: [
    ex('bankdruecken', 'Bankdrücken (Langhantel)', 'kg', 4, 6, 8, 2.5, 'Schulterblätter zusammen, Füße fest am Boden, Stange zur unteren Brust führen, Ellbogen ca. 45° vom Körper.'),
    ex('schraegbank', 'Schrägbankdrücken (Kurzhantel, 30°)', 'kg', 3, 8, 12, 2, 'Hanteln tief absenken, oben nicht zusammenschlagen.'),
    ex('dips', 'Dips (Brust-Fokus)', 'bw', 3, 8, 12, 2.5, 'Oberkörper leicht nach vorn, absenken bis der Oberarm parallel zum Boden ist.'),
    ex('kabelflys', 'Kabelzug-Flys', 'kg', 3, 12, 15, 1.25, 'Leicht gebeugte Arme, Hände vor der Brust zusammenführen, 1 Sek. halten.'),
    ex('ueberkopf-trizeps', 'Überkopf-Trizepsstrecken am Kabel', 'kg', 3, 10, 12, 1.25, 'Ellbogen eng und fix, volle Dehnung hinter dem Kopf.'),
    ex('trizeps-seil', 'Trizepsdrücken am Kabel (Seil)', 'kg', 3, 12, 15, 1.25, 'Oberarme am Körper, unten das Seil auseinanderziehen.')
  ] },
  B: { title: 'Rücken & Bizeps', short: 'R&B', exercises: [
    ex('klimmzuege', 'Klimmzüge', 'bw', 4, 6, 10, 2.5, 'Schulterblätter zuerst nach unten ziehen, Brust zur Stange, unten ganz ausstrecken. Mit Unterstützung: Gewicht negativ eintragen.'),
    ex('lh-rudern', 'Langhantelrudern vorgebeugt', 'kg', 4, 6, 8, 2.5, 'Rücken gerade, Oberkörper ca. 45°, Stange zum Bauchnabel ziehen.'),
    ex('kabelrudern', 'Kabelrudern sitzend (enger Griff)', 'kg', 3, 10, 12, 2.5, 'Brust raus, Ellbogen eng nach hinten, vorne kontrolliert dehnen.'),
    ex('facepulls', 'Face Pulls am Kabel', 'kg', 3, 12, 15, 1.25, 'Seil auf Augenhöhe, Hände neben die Ohren ziehen, Schultern nach außen drehen.'),
    ex('sz-curls', 'Langhantel-Curls (SZ-Stange)', 'kg', 3, 8, 12, 2.5, 'Ellbogen am Körper, kein Schwung aus dem Rücken.'),
    ex('hammer-curls', 'Hammer-Curls (Kurzhantel)', 'kg', 3, 10, 12, 2, 'Neutraler Griff, langsam absenken.')
  ] },
  C: { title: 'Beine & Bauch', short: 'B&B', exercises: [
    ex('kniebeugen', 'Kniebeugen (Langhantel)', 'kg', 4, 6, 8, 2.5, 'Füße schulterbreit, Knie über den Zehen, mindestens bis Oberschenkel parallel, Rücken neutral.'),
    ex('rdl', 'Rumänisches Kreuzheben', 'kg', 3, 8, 10, 2.5, 'Knie leicht gebeugt, Hüfte nach hinten schieben, Stange nah am Bein, Dehnung im Beinbizeps.'),
    ex('beinpresse', 'Beinpresse', 'kg', 3, 10, 12, 5, 'Unterer Rücken bleibt am Polster, Knie oben nicht ganz durchstrecken.'),
    ex('beinbeuger', 'Beinbeuger', 'kg', 3, 10, 12, 2.5, 'Hüfte fest aufs Polster, langsam zurückführen.'),
    ex('wadenheben', 'Wadenheben stehend', 'kg', 3, 12, 15, 2.5, 'Unten voll dehnen, oben 1 Sek. halten.'),
    ex('beinheben', 'Hängendes Beinheben', 'bw', 3, 10, 15, 0, 'Becken einrollen statt nur die Beine zu schwingen. Alternative: Kabel-Crunch.'),
    ex('plank', 'Plank', 'time', 3, 30, 60, 0, 'Körper in einer Linie, Bauch und Po anspannen.')
  ] }
};

/* ---------- Muskeln: Körper-Illustration (eigene Zeichnung) und Bibliothek ---------- */
const BODY = {"sil":"M91.0,50.0C87.8,53.0 92.2,63.8 90.0,68.0C87.8,72.2 82.7,73.3 78.0,75.0C73.3,76.7 66.5,76.5 62.0,78.0C57.5,79.5 53.8,80.7 51.0,84.0C48.2,87.3 46.2,92.0 45.0,98.0C43.8,104.0 44.7,111.7 44.0,120.0C43.3,128.3 41.7,140.3 41.0,148.0C40.3,155.7 40.8,159.0 40.0,166.0C39.2,173.0 37.3,182.0 36.0,190.0C34.7,198.0 33.1,206.7 32.0,214.0C30.9,221.3 30.8,228.7 29.5,234.0C28.2,239.3 25.4,241.3 24.0,246.0C22.6,250.7 20.7,257.7 21.0,262.0C21.3,266.3 23.8,271.7 25.7,272.0C27.6,272.3 30.9,268.0 32.7,264.0C34.5,260.0 34.8,254.0 36.7,248.0C38.6,242.0 41.8,236.3 44.0,228.0C46.2,219.7 48.3,207.0 50.0,198.0C51.7,189.0 52.8,181.7 54.0,174.0C55.2,166.3 56.0,159.0 57.0,152.0C58.0,145.0 58.8,136.0 60.0,132.0C61.2,128.0 62.8,125.0 64.0,128.0C65.2,131.0 66.2,141.7 67.0,150.0C67.8,158.3 69.0,169.0 69.0,178.0C69.0,187.0 67.7,196.7 67.0,204.0C66.3,211.3 66.2,214.3 65.0,222.0C63.8,229.7 61.0,239.3 59.5,250.0C58.0,260.7 56.5,274.7 55.9,286.0C55.3,297.3 56.0,309.0 55.9,318.0C55.8,327.0 55.9,331.0 55.1,340.0C54.3,349.0 51.9,361.7 51.1,372.0C50.3,382.3 50.4,394.3 50.3,402.0C50.2,409.7 51.0,413.7 50.3,418.0C49.6,422.3 46.2,425.0 46.0,428.0C45.8,431.0 46.0,434.7 49.0,436.0C52.0,437.3 61.3,438.0 64.0,436.0C66.7,434.0 65.0,428.3 65.0,424.0C65.0,419.7 63.6,417.3 64.3,410.0C65.0,402.7 67.3,390.0 69.1,380.0C70.8,370.0 73.2,358.3 74.8,350.0C76.3,341.7 76.7,338.3 78.4,330.0C80.1,321.7 82.9,310.7 85.2,300.0C87.5,289.3 90.0,274.0 92.5,266.0C95.0,258.0 98.8,254.3 100.0,252.0C101.2,249.7 98.8,249.7 100.0,252.0C101.2,254.3 105.0,258.0 107.5,266.0C110.0,274.0 112.5,289.3 114.8,300.0C117.1,310.7 119.9,321.7 121.6,330.0C123.3,338.3 123.7,341.7 125.2,350.0C126.8,358.3 129.2,370.0 130.9,380.0C132.7,390.0 135.0,402.7 135.7,410.0C136.4,417.3 134.9,419.7 135.0,424.0C135.1,428.3 133.3,434.0 136.0,436.0C138.7,438.0 148.0,437.3 151.0,436.0C154.0,434.7 154.2,431.0 154.0,428.0C153.8,425.0 150.4,422.3 149.7,418.0C149.0,413.7 149.8,409.7 149.7,402.0C149.6,394.3 149.7,382.3 148.9,372.0C148.1,361.7 145.7,349.0 144.9,340.0C144.1,331.0 144.2,327.0 144.1,318.0C144.0,309.0 144.7,297.3 144.1,286.0C143.5,274.7 142.0,260.7 140.5,250.0C139.0,239.3 136.2,229.7 135.0,222.0C133.8,214.3 133.7,211.3 133.0,204.0C132.3,196.7 131.0,187.0 131.0,178.0C131.0,169.0 132.2,158.3 133.0,150.0C133.8,141.7 134.8,131.0 136.0,128.0C137.2,125.0 138.8,128.0 140.0,132.0C141.2,136.0 142.0,145.0 143.0,152.0C144.0,159.0 144.8,166.3 146.0,174.0C147.2,181.7 148.3,189.0 150.0,198.0C151.7,207.0 153.8,219.7 156.0,228.0C158.2,236.3 161.4,242.0 163.3,248.0C165.2,254.0 165.5,260.0 167.3,264.0C169.1,268.0 172.4,272.3 174.3,272.0C176.2,271.7 178.7,266.3 179.0,262.0C179.3,257.7 177.4,250.7 176.0,246.0C174.6,241.3 171.8,239.3 170.5,234.0C169.2,228.7 169.1,221.3 168.0,214.0C166.9,206.7 165.3,198.0 164.0,190.0C162.7,182.0 160.8,173.0 160.0,166.0C159.2,159.0 159.7,155.7 159.0,148.0C158.3,140.3 156.7,128.3 156.0,120.0C155.3,111.7 156.2,104.0 155.0,98.0C153.8,92.0 151.8,87.3 149.0,84.0C146.2,80.7 142.5,79.5 138.0,78.0C133.5,76.5 126.7,76.7 122.0,75.0C117.3,73.3 112.2,72.2 110.0,68.0C107.8,63.8 112.2,53.0 109.0,50.0C105.8,47.0 94.2,47.0 91.0,50.0Z","names":{"brust_o":["Obere Brust","Pectoralis major, Pars clavicularis"],"brust_u":["Untere Brust","Pectoralis major, Pars sternocostalis"],"serratus":["Sägemuskel","Serratus anterior"],"schulter_v":["Vordere Schulter","Deltoideus, Pars clavicularis"],"schulter_s":["Seitliche Schulter","Deltoideus, Pars acromialis"],"schulter_h":["Hintere Schulter","Deltoideus, Pars spinalis"],"nacken":["Nacken","Trapezius, Pars descendens"],"trapez_mu":["Mittlerer/unterer Trapez","Trapezius, Pars transversa et ascendens"],"rhomboiden":["Rautenmuskeln","Rhomboideus major/minor"],"rotatoren":["Rotatorenmanschette","Infraspinatus, Teres minor"],"teres":["Großer Rundmuskel","Teres major"],"latissimus":["Latissimus","Latissimus dorsi"],"ruecken_u":["Rückenstrecker","Erector spinae"],"bizeps":["Bizeps","Biceps brachii"],"brachialis":["Oberarmmuskel","Brachialis"],"brachiorad":["Oberarmspeichenmuskel","Brachioradialis"],"ua_beuger":["Unterarmbeuger","Flexoren des Unterarms"],"ua_strecker":["Unterarmstrecker","Extensoren des Unterarms"],"trizeps_l":["Trizeps, langer Kopf","Triceps brachii, Caput longum"],"trizeps_s":["Trizeps, seitlicher Kopf","Triceps brachii, Caput laterale"],"bauch":["Gerader Bauchmuskel","Rectus abdominis"],"bauch_s":["Schräge Bauchmuskeln","Obliquus externus abdominis"],"hueftbeuger":["Hüftbeuger","Iliopsoas"],"gluteus_m":["Mittlerer Gesäßmuskel","Gluteus medius"],"gluteus":["Großer Gesäßmuskel","Gluteus maximus"],"quad_rf":["Gerader Oberschenkelmuskel","Rectus femoris"],"quad_vl":["Äußerer Quadrizeps","Vastus lateralis"],"quad_vm":["Innerer Quadrizeps","Vastus medialis"],"adduktoren":["Adduktoren","Adductor longus/magnus"],"hams_a":["Beinbeuger außen","Biceps femoris"],"hams_i":["Beinbeuger innen","Semitendinosus, Semimembranosus"],"waden":["Zwillingswadenmuskel","Gastrocnemius"],"soleus":["Schollenmuskel","Soleus"],"schienbein":["Schienbeinmuskel","Tibialis anterior"]},"front":[["brust_o","M99.4,83.7C97.6,81.4 92.5,80.0 88.4,79.4C84.3,78.9 78.7,79.1 75.0,80.5C71.2,81.9 66.0,86.1 66.0,88.1C66.0,90.0 71.2,91.5 75.0,92.4C78.7,93.3 84.3,93.3 88.4,93.5C92.5,93.6 97.6,95.1 99.4,93.5C101.2,91.8 101.2,86.1 99.4,83.7Z M100.6,93.5C102.4,95.1 107.5,93.6 111.6,93.5C115.7,93.3 121.3,93.3 125.0,92.4C128.8,91.5 134.0,90.0 134.0,88.1C134.0,86.1 128.8,81.9 125.0,80.5C121.3,79.1 115.7,78.9 111.6,79.4C107.5,80.0 102.4,81.4 100.6,83.7C98.8,86.1 98.8,91.8 100.6,93.5Z",84.6,87.3],["brust_u","M99.4,95.2C97.7,90.7 92.8,95.3 88.8,95.2C84.8,95.0 79.3,94.1 75.4,94.1C71.5,94.1 67.2,93.2 65.3,95.2C63.5,97.1 63.3,102.0 64.2,106.0C65.1,109.9 67.6,115.7 70.9,118.9C74.3,122.2 79.7,124.9 84.4,125.4C89.0,125.9 96.4,127.2 98.9,122.2C101.4,117.1 101.1,99.7 99.4,95.2Z M101.1,122.2C103.6,127.2 111.0,125.9 115.6,125.4C120.3,124.9 125.7,122.2 129.1,118.9C132.4,115.7 134.9,109.9 135.8,106.0C136.7,102.0 136.5,97.1 134.7,95.2C132.8,93.2 128.5,94.1 124.6,94.1C120.7,94.1 115.2,95.0 111.2,95.2C107.2,95.3 102.3,90.7 100.6,95.2C98.9,99.7 98.6,117.1 101.1,122.2Z",81.0,106.5],["serratus","M65.9,123.2C64.2,123.7 62.0,126.4 61.4,129.7C60.9,132.9 61.4,139.7 62.5,142.6C63.7,145.5 66.6,148.0 68.1,146.9C69.6,145.9 70.9,139.6 71.5,136.1C72.1,132.7 72.4,128.6 71.5,126.4C70.6,124.3 67.6,122.6 65.9,123.2Z M128.5,126.4C127.6,128.6 127.9,132.7 128.5,136.1C129.1,139.6 130.4,145.9 131.9,146.9C133.4,148.0 136.3,145.5 137.5,142.6C138.6,139.7 139.1,132.9 138.6,129.7C138.0,126.4 135.8,123.7 134.1,123.2C132.4,122.6 129.4,124.3 128.5,126.4Z",66.8,134.2],["schulter_v","M70.8,78.8C70.1,77.0 65.2,79.1 63.0,80.9C60.7,82.7 58.3,85.6 57.4,89.6C56.4,93.5 56.8,100.4 57.4,104.7C57.9,109.0 59.4,115.5 60.7,115.5C62.0,115.5 64.1,108.7 65.2,104.7C66.3,100.7 66.5,96.1 67.5,91.7C68.4,87.4 71.6,80.6 70.8,78.8Z M132.5,91.7C133.5,96.1 133.7,100.7 134.8,104.7C135.9,108.7 138.0,115.5 139.3,115.5C140.6,115.5 142.1,109.0 142.6,104.7C143.2,100.4 143.6,93.5 142.6,89.6C141.7,85.6 139.3,82.7 137.0,80.9C134.8,79.1 129.9,77.0 129.2,78.8C128.4,80.6 131.6,87.4 132.5,91.7Z",63.1,95.1],["schulter_s","M59.7,78.6C59.1,77.9 53.9,81.8 51.8,85.1C49.8,88.3 47.9,93.5 47.4,98.0C46.8,102.5 47.4,108.8 48.5,112.1C49.6,115.3 52.8,118.7 54.1,117.5C55.4,116.2 56.1,109.2 56.3,104.5C56.5,99.8 54.6,93.7 55.2,89.4C55.8,85.1 60.2,79.3 59.7,78.6Z M144.8,89.4C145.4,93.7 143.5,99.8 143.7,104.5C143.9,109.2 144.6,116.2 145.9,117.5C147.2,118.7 150.4,115.3 151.5,112.1C152.6,108.8 153.2,102.5 152.6,98.0C152.1,93.5 150.2,88.3 148.2,85.1C146.1,81.8 140.9,77.9 140.3,78.6C139.8,79.3 144.2,85.1 144.8,89.4Z",53.3,97.9],["nacken","M89.6,63.3C87.8,63.1 85.0,68.5 81.8,70.9C78.6,73.2 70.2,75.9 70.6,77.4C71.0,78.8 80.3,80.4 84.0,79.5C87.8,78.6 92.1,74.7 93.0,72.0C93.9,69.3 91.5,63.5 89.6,63.3Z M107.0,72.0C107.9,74.7 112.2,78.6 116.0,79.5C119.7,80.4 129.0,78.8 129.4,77.4C129.8,75.9 121.4,73.2 118.2,70.9C115.0,68.5 112.2,63.1 110.4,63.3C108.5,63.5 106.1,69.3 107.0,72.0Z",83.8,72.6],["latissimus","M64.8,127.0C63.5,127.4 62.4,133.5 62.5,137.8C62.7,142.1 64.6,151.1 65.9,152.9C67.2,154.7 69.6,151.5 70.4,148.6C71.1,145.7 71.3,139.2 70.4,135.6C69.5,132.0 66.1,126.6 64.8,127.0Z M129.6,135.6C128.7,139.2 128.9,145.7 129.6,148.6C130.4,151.5 132.8,154.7 134.1,152.9C135.4,151.1 137.3,142.1 137.5,137.8C137.6,133.5 136.5,127.4 135.2,127.0C133.9,126.6 130.5,132.0 129.6,135.6Z",67,150],["bizeps","M56.3,116.2C55.0,116.2 53.1,118.8 51.8,122.7C50.5,126.7 49.2,134.4 48.4,140.0C47.7,145.6 47.0,151.7 47.3,156.2C47.7,160.7 49.2,166.8 50.7,167.0C52.2,167.2 55.0,162.1 56.3,157.3C57.6,152.4 58.0,143.6 58.5,137.8C59.1,132.1 60.0,126.3 59.6,122.7C59.3,119.1 57.6,116.2 56.3,116.2Z M140.4,122.7C140.0,126.3 140.9,132.1 141.5,137.8C142.0,143.6 142.4,152.4 143.7,157.3C145.0,162.1 147.8,167.2 149.3,167.0C150.8,166.8 152.3,160.7 152.7,156.2C153.0,151.7 152.3,145.6 151.6,140.0C150.8,134.4 149.5,126.7 148.2,122.7C146.9,118.8 145.0,116.2 143.7,116.2C142.4,116.2 140.7,119.1 140.4,122.7Z",53,136],["brachialis","M48.3,126.4C47.9,126.4 45.8,134.5 44.9,139.4C44.0,144.3 42.7,150.9 42.7,155.6C42.7,160.3 44.2,167.3 44.9,167.5C45.6,167.7 46.8,161.4 47.1,156.7C47.5,152.0 47.0,144.4 47.1,139.4C47.3,134.4 48.6,126.4 48.3,126.4Z M152.9,139.4C153.0,144.4 152.5,152.0 152.9,156.7C153.2,161.4 154.4,167.7 155.1,167.5C155.8,167.3 157.3,160.3 157.3,155.6C157.3,150.9 156.0,144.3 155.1,139.4C154.2,134.5 152.1,126.4 151.7,126.4C151.4,126.4 152.7,134.4 152.9,139.4Z",45.8,147.5],["brachiorad","M44.4,167.2C43.1,167.9 41.4,170.9 39.9,175.8C38.4,180.6 36.6,189.7 35.5,196.3C34.3,203.0 33.0,211.4 33.2,215.8C33.4,220.1 35.3,224.2 36.6,222.2C37.9,220.2 39.6,210.2 41.1,203.9C42.6,197.6 44.4,189.8 45.5,184.4C46.7,179.0 48.0,174.3 47.8,171.5C47.6,168.6 45.7,166.4 44.4,167.2Z M152.2,171.5C152.0,174.3 153.3,179.0 154.5,184.4C155.6,189.8 157.4,197.6 158.9,203.9C160.4,210.2 162.1,220.2 163.4,222.2C164.7,224.2 166.6,220.1 166.8,215.8C167.0,211.4 165.7,203.0 164.5,196.3C163.4,189.7 161.6,180.6 160.1,175.8C158.6,170.9 156.9,167.9 155.6,167.2C154.3,166.4 152.4,168.6 152.2,171.5Z",40.5,192.1],["ua_beuger","M50.4,168.7C49.3,169.8 48.4,175.7 47.1,181.7C45.8,187.6 44.1,196.6 42.6,204.3C41.1,212.1 38.4,222.9 38.1,228.1C37.8,233.3 39.5,238.0 41.0,235.7C42.5,233.3 45.3,221.4 47.1,214.1C48.8,206.7 50.4,197.9 51.5,191.4C52.7,184.9 54.0,178.9 53.8,175.2C53.6,171.4 51.5,167.6 50.4,168.7Z M146.2,175.2C146.0,178.9 147.3,184.9 148.5,191.4C149.6,197.9 151.2,206.7 152.9,214.1C154.7,221.4 157.5,233.3 159.0,235.7C160.5,238.0 162.2,233.3 161.9,228.1C161.6,222.9 158.9,212.1 157.4,204.3C155.9,196.6 154.2,187.6 152.9,181.7C151.6,175.7 150.7,169.8 149.6,168.7C148.5,167.6 146.4,171.4 146.2,175.2Z",46.5,199.9],["bauch","M99.4,123.5C97.3,107.2 89.3,120.1 86.6,122.5C83.9,124.8 83.8,129.7 83.3,137.6C82.7,145.5 82.9,159.4 83.3,170.0C83.6,180.6 84.0,193.7 85.5,201.3C87.0,208.9 89.9,212.1 92.2,215.3C94.6,218.6 98.2,236.0 99.4,220.7C100.6,205.4 101.5,139.9 99.4,123.5Z M100.6,220.7C101.8,236.0 105.4,218.6 107.8,215.3C110.1,212.1 113.0,208.9 114.5,201.3C116.0,193.7 116.4,180.6 116.7,170.0C117.1,159.4 117.3,145.5 116.7,137.6C116.2,129.7 116.1,124.8 113.4,122.5C110.7,120.1 102.7,107.2 100.6,123.5C98.5,139.9 99.4,205.4 100.6,220.7Z",92,178],["bauch_s","M82.6,126.2C81.1,122.8 74.7,124.6 72.5,128.3C70.2,132.1 69.3,140.8 69.1,148.9C68.9,157.0 70.2,168.8 71.4,176.9C72.5,185.0 73.8,192.2 75.8,197.5C77.9,202.7 82.6,211.3 83.7,208.3C84.8,205.2 82.9,189.0 82.6,179.1C82.2,169.2 81.4,157.7 81.4,148.9C81.4,140.0 84.0,129.6 82.6,126.2Z M118.6,148.9C118.6,157.7 117.8,169.2 117.4,179.1C117.1,189.0 115.2,205.2 116.3,208.3C117.4,211.3 122.1,202.7 124.2,197.5C126.2,192.2 127.5,185.0 128.6,176.9C129.8,168.8 131.1,157.0 130.9,148.9C130.7,140.8 129.8,132.1 127.5,128.3C125.3,124.6 118.9,122.8 117.4,126.2C116.0,129.6 118.6,140.0 118.6,148.9Z",76,160],["hueftbeuger","M87.0,212.0C84.5,210.0 80.9,211.8 80.2,215.2C79.6,218.7 81.5,228.2 83.3,232.5C85.1,236.8 89.2,242.1 91.1,241.2C93.0,240.3 95.5,232.0 94.8,227.1C94.1,222.3 89.4,214.0 87.0,212.0Z M105.2,227.1C104.5,232.0 107.0,240.3 108.9,241.2C110.8,242.1 114.9,236.8 116.7,232.5C118.5,228.2 120.4,218.7 119.8,215.2C119.1,211.8 115.5,210.0 113.0,212.0C110.6,214.0 105.9,222.3 105.2,227.1Z",87.3,225.6],["gluteus_m","M70.1,203.2C68.8,203.6 66.4,208.2 65.6,211.8C64.9,215.4 64.7,223.4 65.6,224.8C66.5,226.2 69.9,223.0 71.2,220.5C72.5,218.0 73.6,212.6 73.5,209.7C73.3,206.8 71.4,202.8 70.1,203.2Z M126.5,209.7C126.4,212.6 127.5,218.0 128.8,220.5C130.1,223.0 133.5,226.2 134.4,224.8C135.3,223.4 135.1,215.4 134.4,211.8C133.6,208.2 131.2,203.6 129.9,203.2C128.6,202.8 126.7,206.8 126.5,209.7Z",69.2,214.0],["quad_rf","M78.4,226.4C76.6,227.2 74.0,239.0 72.3,248.0C70.5,257.0 68.9,270.7 68.0,280.4C67.1,290.2 66.6,299.9 66.9,306.4C67.1,312.8 68.0,320.0 69.6,319.3C71.2,318.6 74.4,310.3 76.4,302.0C78.4,293.8 80.6,279.4 81.7,269.6C82.7,259.9 83.4,250.9 82.9,243.7C82.4,236.5 80.2,225.7 78.4,226.4Z M117.1,243.7C116.6,250.9 117.3,259.9 118.3,269.6C119.4,279.4 121.6,293.8 123.6,302.0C125.6,310.3 128.8,318.6 130.4,319.3C132.0,320.0 132.9,312.8 133.1,306.4C133.4,299.9 132.9,290.2 132.0,280.4C131.1,270.7 129.5,257.0 127.7,248.0C126.0,239.0 123.4,227.2 121.6,226.4C119.8,225.7 117.6,236.5 117.1,243.7Z",75.6,265],["quad_vl","M70.4,228.5C68.8,229.2 64.6,239.3 62.3,247.9C60.1,256.6 58.0,269.7 56.9,280.3C55.9,290.9 55.5,304.1 56.2,311.6C56.8,319.2 59.6,327.3 61.1,325.7C62.6,324.1 64.1,311.3 65.3,301.9C66.6,292.6 67.3,279.2 68.4,269.5C69.4,259.8 71.5,250.4 71.8,243.6C72.2,236.8 72.0,227.8 70.4,228.5Z M128.2,243.6C128.5,250.4 130.6,259.8 131.6,269.5C132.7,279.2 133.4,292.6 134.7,301.9C135.9,311.3 137.4,324.1 138.9,325.7C140.4,327.3 143.2,319.2 143.8,311.6C144.5,304.1 144.1,290.9 143.1,280.3C142.0,269.7 139.9,256.6 137.7,247.9C135.4,239.3 131.2,229.2 129.6,228.5C128.0,227.8 127.8,236.8 128.2,243.6Z",61.4,282],["quad_vm","M81.5,281.2C80.0,281.6 77.2,292.7 75.9,298.5C74.6,304.2 73.6,311.3 73.7,315.8C73.8,320.3 75.3,325.5 76.8,325.5C78.3,325.5 81.3,320.6 82.7,315.8C84.0,310.9 85.3,302.1 85.1,296.3C84.9,290.6 83.1,280.8 81.5,281.2Z M114.9,296.3C114.7,302.1 116.0,310.9 117.3,315.8C118.7,320.6 121.7,325.5 123.2,325.5C124.7,325.5 126.2,320.3 126.3,315.8C126.4,311.3 125.4,304.2 124.1,298.5C122.8,292.7 120.0,281.6 118.5,281.2C116.9,280.8 115.1,290.6 114.9,296.3Z",79.3,305.5],["adduktoren","M88.5,231.7C85.7,232.5 83.5,245.8 82.4,253.3C81.2,260.9 81.0,270.8 81.5,277.1C81.9,283.4 83.4,292.2 85.2,291.1C87.0,290.1 90.0,277.6 92.3,270.6C94.7,263.6 100.0,255.5 99.4,249.0C98.8,242.5 91.4,231.0 88.5,231.7Z M100.6,249.0C100.0,255.5 105.3,263.6 107.7,270.6C110.0,277.6 113.0,290.1 114.8,291.1C116.6,292.2 118.1,283.4 118.5,277.1C119.0,270.8 118.8,260.9 117.6,253.3C116.5,245.8 114.3,232.5 111.5,231.7C108.6,231.0 101.2,242.5 100.6,249.0Z",88.3,262.2],["waden","M71.4,337.2C69.9,338.7 67.9,348.0 66.9,354.5C65.8,361.0 65.1,371.1 65.2,376.1C65.3,381.2 66.1,386.2 67.4,384.8C68.7,383.3 71.6,374.0 73.0,367.5C74.4,361.0 76.1,350.9 75.8,345.9C75.5,340.8 72.8,335.8 71.4,337.2Z M124.2,345.9C123.9,350.9 125.6,361.0 127.0,367.5C128.4,374.0 131.3,383.3 132.6,384.8C133.9,386.2 134.7,381.2 134.8,376.1C134.9,371.1 134.2,361.0 133.1,354.5C132.1,348.0 130.1,338.7 128.6,337.2C127.2,335.8 124.5,340.8 124.2,345.9Z",70.0,361.0],["soleus","M58.3,370.6C57.5,371.0 54.8,386.4 54.2,392.2C53.7,398.0 54.0,405.5 54.8,405.2C55.6,404.8 58.5,395.8 59.1,390.0C59.6,384.3 59.1,370.2 58.3,370.6Z M140.9,390.0C141.5,395.8 144.4,404.8 145.2,405.2C146.0,405.5 146.3,398.0 145.8,392.2C145.2,386.4 142.5,371.0 141.7,370.6C140.9,370.2 140.4,384.3 140.9,390.0Z",56.6,389.5],["schienbein","M63.7,336.2C62.4,336.5 59.6,346.4 58.0,354.5C56.4,362.6 54.7,376.1 54.0,384.8C53.2,393.4 52.9,403.1 53.4,406.4C53.9,409.6 55.8,408.5 57.1,404.2C58.4,399.9 59.9,389.1 61.3,380.5C62.8,371.8 65.7,359.8 66.0,352.4C66.4,345.0 65.0,335.8 63.7,336.2Z M134.0,352.4C134.3,359.8 137.2,371.8 138.7,380.5C140.1,389.1 141.6,399.9 142.9,404.2C144.2,408.5 146.1,409.6 146.6,406.4C147.1,403.1 146.8,393.4 146.0,384.8C145.3,376.1 143.6,362.6 142.0,354.5C140.4,346.4 137.6,336.5 136.3,336.2C135.0,335.8 133.6,345.0 134.0,352.4Z",59.1,374.1]],"back":[["schulter_s","M50.2,82.9C49.2,82.9 46.6,87.5 45.7,91.5C44.7,95.5 44.0,102.7 44.6,106.6C45.1,110.6 47.9,116.0 49.0,115.3C50.2,114.5 50.9,106.3 51.3,102.3C51.7,98.3 51.5,94.7 51.3,91.5C51.1,88.3 51.1,82.9 50.2,82.9Z M148.7,91.5C148.5,94.7 148.3,98.3 148.7,102.3C149.1,106.3 149.8,114.5 151.0,115.3C152.1,116.0 154.9,110.6 155.4,106.6C156.0,102.7 155.3,95.5 154.3,91.5C153.4,87.5 150.8,82.9 149.8,82.9C148.9,82.9 148.9,88.3 148.7,91.5Z",48.7,98.3],["schulter_h","M66.8,81.2C64.7,79.4 59.3,80.9 56.7,82.3C54.1,83.7 51.9,86.3 51.1,89.9C50.4,93.5 50.7,102.1 52.2,103.9C53.7,105.7 57.3,102.5 60.1,100.7C62.9,98.9 67.9,96.3 69.0,93.1C70.2,89.9 68.9,83.0 66.8,81.2Z M131.0,93.1C132.1,96.3 137.1,98.9 139.9,100.7C142.7,102.5 146.3,105.7 147.8,103.9C149.3,102.1 149.6,93.5 148.9,89.9C148.1,86.3 145.9,83.7 143.3,82.3C140.7,80.9 135.3,79.4 133.2,81.2C131.1,83.0 129.8,89.9 131.0,93.1Z",59.3,91.8],["nacken","M99.4,56.8C97.9,53.2 93.8,60.7 90.4,63.3C87.1,65.8 83.3,69.2 79.2,71.9C75.1,74.6 65.1,77.5 65.8,79.5C66.5,81.4 78.1,82.9 83.7,83.8C89.3,84.7 96.8,89.4 99.4,84.9C102.0,80.4 100.9,60.4 99.4,56.8Z M100.6,84.9C103.2,89.4 110.7,84.7 116.3,83.8C121.9,82.9 133.5,81.4 134.2,79.5C134.9,77.5 124.9,74.6 120.8,71.9C116.7,69.2 112.9,65.8 109.6,63.3C106.2,60.7 102.1,53.2 100.6,56.8C99.1,60.4 98.0,80.4 100.6,84.9Z",86.3,73.3],["trapez_mu","M99.4,84.7C98.1,73.3 93.4,83.9 91.7,86.8C90.1,89.7 89.7,95.6 89.5,101.9C89.3,108.2 89.7,117.6 90.6,124.6C91.5,131.6 93.6,139.0 95.1,144.1C96.5,149.1 98.7,164.8 99.4,154.9C100.1,145.0 100.7,96.0 99.4,84.7Z M100.6,154.9C101.3,164.8 103.5,149.1 104.9,144.1C106.4,139.0 108.5,131.6 109.4,124.6C110.3,117.6 110.7,108.2 110.5,101.9C110.3,95.6 109.9,89.7 108.3,86.8C106.6,83.9 101.9,73.3 100.6,84.7C99.3,96.0 99.9,145.0 100.6,154.9Z",94.3,116.2],["rhomboiden","M89.5,88.8C88.2,86.7 82.6,88.6 80.6,91.0C78.5,93.3 76.8,98.4 77.2,102.9C77.6,107.4 80.7,114.6 82.8,118.0C84.9,121.4 88.6,125.7 89.5,123.4C90.5,121.0 88.4,109.7 88.4,103.9C88.4,98.2 90.8,91.0 89.5,88.8Z M111.6,103.9C111.6,109.7 109.5,121.0 110.5,123.4C111.4,125.7 115.1,121.4 117.2,118.0C119.3,114.6 122.4,107.4 122.8,102.9C123.2,98.4 121.5,93.3 119.4,91.0C117.4,88.6 111.8,86.7 110.5,88.8C109.2,91.0 111.6,98.2 111.6,103.9Z",84.7,104.7],["rotatoren","M76.4,94.2C74.8,92.9 69.7,94.2 67.5,96.3C65.2,98.5 62.6,103.9 63.0,107.1C63.4,110.4 66.9,114.5 69.7,115.8C72.5,117.0 78.5,116.7 79.8,114.7C81.1,112.7 78.1,107.3 77.6,103.9C77.0,100.5 78.1,95.4 76.4,94.2Z M122.4,103.9C121.9,107.3 118.9,112.7 120.2,114.7C121.5,116.7 127.5,117.0 130.3,115.8C133.1,114.5 136.6,110.4 137.0,107.1C137.4,103.9 134.8,98.5 132.5,96.3C130.3,94.2 125.2,92.9 123.6,94.2C121.9,95.4 123.0,100.5 122.4,103.9Z",72.3,105.3],["teres","M70.1,117.6C67.2,117.2 63.8,117.9 62.3,119.7C60.8,121.5 59.9,126.6 61.2,128.4C62.5,130.2 67.0,131.6 70.1,130.5C73.3,129.4 80.2,124.0 80.2,121.9C80.2,119.7 73.1,117.9 70.1,117.6Z M119.8,121.9C119.8,124.0 126.7,129.4 129.9,130.5C133.0,131.6 137.5,130.2 138.8,128.4C140.1,126.6 139.2,121.5 137.7,119.7C136.2,117.9 132.8,117.2 129.9,117.6C126.9,117.9 119.8,119.7 119.8,121.9Z",68.8,123.6],["latissimus","M81.2,118.0C77.1,115.1 69.8,122.5 66.6,127.7C63.5,132.9 62.0,141.8 62.2,149.3C62.3,156.9 65.0,166.6 67.8,173.1C70.6,179.6 74.8,184.4 79.0,188.2C83.1,192.0 89.8,198.6 92.4,195.8C95.0,192.9 94.8,179.4 94.6,170.9C94.4,162.5 93.5,153.8 91.3,145.0C89.0,136.2 85.3,120.9 81.2,118.0Z M108.7,145.0C106.5,153.8 105.6,162.5 105.4,170.9C105.2,179.4 105.0,192.9 107.6,195.8C110.2,198.6 116.9,192.0 121.0,188.2C125.2,184.4 129.4,179.6 132.2,173.1C135.0,166.6 137.7,156.9 137.8,149.3C138.0,141.8 136.5,132.9 133.4,127.7C130.2,122.5 122.9,115.1 118.8,118.0C114.7,120.9 111.0,136.2 108.7,145.0Z",79.4,158.5],["ruecken_u","M98.4,150.9C97.5,139.7 94.1,145.7 92.8,149.8C91.5,153.9 90.8,166.5 90.6,175.7C90.4,184.9 90.4,198.0 91.7,204.9C93.0,211.7 97.3,225.8 98.4,216.8C99.6,207.8 99.4,162.0 98.4,150.9Z M101.6,216.8C102.7,225.8 107.0,211.7 108.3,204.9C109.6,198.0 109.6,184.9 109.4,175.7C109.2,166.5 108.5,153.9 107.2,149.8C105.9,145.7 102.5,139.7 101.6,150.9C100.6,162.0 100.4,207.8 101.6,216.8Z",94.4,179.6],["ua_strecker","M48.6,164.7C46.6,166.1 44.2,172.2 41.9,178.7C39.7,185.2 36.9,195.6 35.2,203.6C33.5,211.5 31.7,221.5 31.8,226.2C32.0,230.9 34.5,234.7 36.3,231.6C38.2,228.6 40.8,215.4 43.0,207.9C45.3,200.3 47.9,192.6 49.8,186.3C51.6,180.0 54.4,173.7 54.2,170.1C54.1,166.5 50.7,163.2 48.6,164.7Z M145.8,170.1C145.6,173.7 148.4,180.0 150.2,186.3C152.1,192.6 154.7,200.3 157.0,207.9C159.2,215.4 161.8,228.6 163.7,231.6C165.5,234.7 168.0,230.9 168.2,226.2C168.3,221.5 166.5,211.5 164.8,203.6C163.1,195.6 160.3,185.2 158.1,178.7C155.8,172.2 153.4,166.1 151.4,164.7C149.3,163.2 145.9,166.5 145.8,170.1Z",42.6,196.1],["trizeps_l","M59.1,104.2C57.8,103.7 55.4,110.7 54.6,116.1C53.9,121.5 54.2,130.3 54.6,136.6C55.0,142.9 55.7,153.2 56.9,153.9C58.0,154.6 60.4,146.7 61.3,140.9C62.3,135.2 62.8,125.4 62.5,119.3C62.1,113.2 60.4,104.7 59.1,104.2Z M137.5,119.3C137.2,125.4 137.7,135.2 138.7,140.9C139.6,146.7 142.0,154.6 143.1,153.9C144.3,153.2 145.0,142.9 145.4,136.6C145.8,130.3 146.1,121.5 145.4,116.1C144.6,110.7 142.2,103.7 140.9,104.2C139.6,104.7 137.9,113.2 137.5,119.3Z",58.2,128.5],["trizeps_s","M51.1,108.2C50.0,109.6 47.8,117.4 46.6,123.3C45.5,129.2 44.2,137.9 44.4,143.8C44.6,149.8 46.3,157.7 47.8,158.9C49.3,160.2 52.4,156.2 53.4,151.4C54.3,146.5 53.4,135.9 53.4,129.8C53.4,123.7 53.7,118.3 53.4,114.7C53.0,111.1 52.2,106.7 51.1,108.2Z M146.6,114.7C146.3,118.3 146.6,123.7 146.6,129.8C146.6,135.9 145.7,146.5 146.6,151.4C147.6,156.2 150.7,160.2 152.2,158.9C153.7,157.7 155.4,149.8 155.6,143.8C155.8,137.9 154.5,129.2 153.4,123.3C152.2,117.4 150.0,109.6 148.9,108.2C147.8,106.7 147.0,111.1 146.6,114.7Z",50.0,132.9],["bauch_s","M65.8,174.8C64.7,175.8 63.4,187.0 63.5,192.0C63.7,197.1 65.4,203.6 66.9,205.0C68.4,206.4 71.9,203.9 72.5,200.7C73.1,197.4 71.4,189.9 70.3,185.6C69.1,181.2 66.9,173.7 65.8,174.8Z M129.7,185.6C128.6,189.9 126.9,197.4 127.5,200.7C128.1,203.9 131.6,206.4 133.1,205.0C134.6,203.6 136.3,197.1 136.5,192.0C136.6,187.0 135.3,175.8 134.2,174.8C133.1,173.7 130.9,181.2 129.7,185.6Z",67.8,191.6],["gluteus_m","M71.6,204.2C68.3,205.3 66.0,208.0 64.9,211.8C63.8,215.6 63.1,224.4 64.9,226.9C66.8,229.4 72.4,229.1 76.1,226.9C79.9,224.7 85.8,217.5 87.3,213.9C88.8,210.3 87.7,206.9 85.1,205.3C82.5,203.7 75.0,203.1 71.6,204.2Z M114.9,205.3C112.3,206.9 111.2,210.3 112.7,213.9C114.2,217.5 120.1,224.7 123.9,226.9C127.6,229.1 133.2,229.4 135.1,226.9C136.9,224.4 136.2,215.6 135.1,211.8C134.0,208.0 131.7,205.3 128.4,204.2C125.0,203.1 117.5,203.7 114.9,205.3Z",75.0,214.8],["gluteus","M87.6,213.0C83.4,213.5 77.9,222.0 74.2,225.9C70.5,229.9 66.9,231.5 65.3,236.7C63.8,242.0 62.5,252.4 64.9,257.3C67.2,262.1 73.7,265.5 79.4,265.9C85.2,266.3 96.1,266.6 99.4,259.4C102.7,252.2 101.4,230.4 99.4,222.7C97.4,215.0 91.8,212.4 87.6,213.0Z M100.6,222.7C98.6,230.4 97.3,252.2 100.6,259.4C103.9,266.6 114.8,266.3 120.6,265.9C126.3,265.5 132.8,262.1 135.1,257.3C137.5,252.4 136.2,242.0 134.7,236.7C133.1,231.5 129.5,229.9 125.8,225.9C122.1,222.0 116.6,213.5 112.4,213.0C108.2,212.4 102.6,215.0 100.6,222.7Z",81.8,240.1],["quad_vl","M62.4,260.0C61.8,256.7 58.3,273.6 57.2,281.6C56.2,289.5 55.6,304.2 56.1,307.5C56.6,310.7 59.3,308.9 60.3,301.0C61.4,293.1 62.9,263.2 62.4,260.0Z M139.7,301.0C140.7,308.9 143.4,310.7 143.9,307.5C144.4,304.2 143.8,289.5 142.8,281.6C141.7,273.6 138.2,256.7 137.6,260.0C137.1,263.2 138.6,293.1 139.7,301.0Z",59.0,287.5],["adduktoren","M93.4,260.7C92.8,258.5 89.3,268.2 88.2,273.6C87.1,279.0 86.3,290.9 86.9,293.1C87.4,295.2 90.6,292.0 91.7,286.6C92.8,281.2 93.9,262.8 93.4,260.7Z M108.3,286.6C109.4,292.0 112.6,295.2 113.1,293.1C113.7,290.9 112.9,279.0 111.8,273.6C110.7,268.2 107.2,258.5 106.6,260.7C106.1,262.8 107.2,281.2 108.3,286.6Z",90.0,278.5],["hams_a","M66.7,262.7C64.5,264.7 62.1,274.1 60.8,281.1C59.5,288.1 58.5,298.0 58.9,304.8C59.3,311.7 61.6,319.8 63.3,322.1C65.0,324.5 68.2,323.4 69.3,318.9C70.5,314.4 69.5,303.4 70.2,295.1C70.9,286.8 74.2,274.6 73.6,269.2C73.0,263.8 68.8,260.7 66.7,262.7Z M126.4,269.2C125.8,274.6 129.1,286.8 129.8,295.1C130.5,303.4 129.5,314.4 130.7,318.9C131.8,323.4 135.0,324.5 136.7,322.1C138.4,319.8 140.7,311.7 141.1,304.8C141.5,298.0 140.5,288.1 139.2,281.1C137.9,274.1 135.5,264.7 133.3,262.7C131.2,260.7 127.0,263.8 126.4,269.2Z",66.1,293.4],["hams_i","M76.8,266.2C74.5,270.5 74.3,282.0 73.7,290.0C73.0,297.9 72.0,308.1 72.8,313.7C73.5,319.3 76.3,325.6 78.3,323.4C80.2,321.3 82.6,308.9 84.6,300.8C86.6,292.7 89.8,281.0 90.2,274.8C90.7,268.7 89.5,265.5 87.2,264.0C85.0,262.6 79.1,261.9 76.8,266.2Z M112.8,264.0C110.5,265.5 109.3,268.7 109.8,274.8C110.2,281.0 113.4,292.7 115.4,300.8C117.4,308.9 119.8,321.3 121.7,323.4C123.7,325.6 126.5,319.3 127.2,313.7C128.0,308.1 127.0,297.9 126.3,290.0C125.7,282.0 125.5,270.5 123.2,266.2C120.9,261.9 115.0,262.6 112.8,264.0Z",80.5,290.4],["waden","M58.8,332.4C56.6,334.6 55.1,343.4 54.2,349.7C53.4,356.0 52.9,365.5 53.8,370.2C54.7,374.9 57.8,380.1 59.6,377.8C61.4,375.4 63.4,363.0 64.6,356.2C65.9,349.3 68.2,340.7 67.2,336.7C66.2,332.8 61.0,330.3 58.8,332.4Z M132.8,336.7C131.8,340.7 134.1,349.3 135.4,356.2C136.6,363.0 138.6,375.4 140.4,377.8C142.2,380.1 145.3,374.9 146.2,370.2C147.1,365.5 146.6,356.0 145.8,349.7C144.9,343.4 143.4,334.6 141.2,332.4C139.0,330.3 133.8,332.8 132.8,336.7Z M68.4,334.6C66.8,337.8 66.1,349.3 65.6,356.2C65.0,363.0 64.1,373.1 65.2,375.6C66.4,378.1 70.6,375.6 72.5,371.3C74.4,367.0 76.0,355.4 76.4,349.7C76.8,343.9 76.2,339.2 74.9,336.7C73.5,334.2 69.9,331.3 68.4,334.6Z M125.1,336.7C123.8,339.2 123.2,343.9 123.6,349.7C124.0,355.4 125.6,367.0 127.5,371.3C129.4,375.6 133.6,378.1 134.8,375.6C135.9,373.1 135.0,363.0 134.4,356.2C133.9,349.3 133.2,337.8 131.6,334.6C130.1,331.3 126.5,334.2 125.1,336.7Z",59.7,353.8],["soleus","M53.6,368.6C51.9,370.2 50.7,385.2 50.7,391.3C50.6,397.4 51.3,403.0 53.3,405.3C55.2,407.7 59.6,408.2 62.2,405.3C64.8,402.4 67.5,393.4 68.9,388.0C70.4,382.6 72.3,374.0 71.0,372.9C69.6,371.8 63.8,382.3 60.9,381.6C58.0,380.8 55.3,367.0 53.6,368.6Z M139.1,381.6C136.2,382.3 130.4,371.8 129.0,372.9C127.7,374.0 129.6,382.6 131.1,388.0C132.5,393.4 135.2,402.4 137.8,405.3C140.4,408.2 144.8,407.7 146.7,405.3C148.7,403.0 149.4,397.4 149.3,391.3C149.3,385.2 148.1,370.2 146.4,368.6C144.7,367.0 142.0,380.8 139.1,381.6Z",60.1,387.6]],"right":{"f":["adduktoren","brachialis","brachiorad","gluteus_m","hams_i","nacken","quad_vm","rhomboiden","schulter_s","serratus","soleus","teres","trizeps_s","waden"],"b":["brachialis","brachiorad","gluteus_m","hams_i","quad_vl","quad_vm","rhomboiden","schulter_s","soleus","teres","trizeps_s"]},"groups":{"Brust":["brust_o","brust_u","serratus"],"Schulter":["schulter_v","schulter_s","schulter_h","rotatoren","nacken"],"Rücken":["trapez_mu","rhomboiden","teres","latissimus","ruecken_u"],"Arme":["bizeps","brachialis","brachiorad","ua_beuger","ua_strecker","trizeps_l","trizeps_s"],"Bauch":["bauch","bauch_s","hueftbeuger"],"Beine":["gluteus","gluteus_m","quad_rf","quad_vl","quad_vm","adduktoren","hams_a","hams_i","waden","soleus","schienbein"]}};
const EX_LIB = [["bankdruecken","Bankdrücken (Langhantel)","kg","brust_u,brust_o","schulter_v,trizeps_s,trizeps_l"],["kh-bankdruecken","Bankdrücken (Kurzhantel)","kg","brust_u","brust_o,schulter_v,trizeps_s,trizeps_l"],["schraegbank","Schrägbankdrücken (Kurzhantel, 30°)","kg","brust_o","brust_u,schulter_v,trizeps_s"],["lh-schraegbank","Schrägbankdrücken (Langhantel)","kg","brust_o","brust_u,schulter_v,trizeps_s,trizeps_l"],["negativbank","Negativbankdrücken","kg","brust_u","trizeps_s,trizeps_l,schulter_v"],["brustpresse","Brustpresse (Maschine)","kg","brust_u","brust_o,schulter_v,trizeps_s"],["dips","Dips (Brust-Fokus)","bw","brust_u,trizeps_l,trizeps_s","brust_o,schulter_v"],["liegestuetze","Liegestütze","bw","brust_u","brust_o,schulter_v,trizeps_s,trizeps_l,serratus,bauch"],["kabelflys","Kabelzug-Flys","kg","brust_u,brust_o","schulter_v"],["butterfly","Butterfly (Maschine)","kg","brust_u","brust_o,schulter_v"],["kh-flys","Kurzhantel-Flys","kg","brust_u","brust_o,schulter_v"],["pullover","Pullover (Kurzhantel)","kg","latissimus,brust_u","teres,trizeps_l,serratus"],["ueberkopf-trizeps","Überkopf-Trizepsstrecken am Kabel","kg","trizeps_l","trizeps_s"],["trizeps-seil","Trizepsdrücken am Kabel (Seil)","kg","trizeps_s,trizeps_l",""],["trizeps-stange","Trizepsdrücken am Kabel (Stange)","kg","trizeps_s","trizeps_l"],["french-press","French Press (SZ-Stange)","kg","trizeps_l,trizeps_s",""],["enges-bankdruecken","Enges Bankdrücken","kg","trizeps_s,trizeps_l","brust_u,schulter_v"],["bankdips","Bankdips","bw","trizeps_s,trizeps_l","schulter_v,brust_u"],["kickbacks","Trizeps-Kickbacks","kg","trizeps_l,trizeps_s","schulter_h"],["schulterdruecken","Schulterdrücken (Kurzhantel)","kg","schulter_v","schulter_s,trizeps_s,trizeps_l,nacken"],["military-press","Schulterdrücken stehend (Langhantel)","kg","schulter_v","schulter_s,trizeps_s,brust_o,nacken,bauch"],["seitheben","Seitheben (Kurzhantel)","kg","schulter_s","schulter_v,nacken"],["seitheben-kabel","Seitheben am Kabel","kg","schulter_s","schulter_v,nacken"],["frontheben","Frontheben","kg","schulter_v","brust_o,schulter_s"],["reverse-flys","Reverse Flys","kg","schulter_h","rhomboiden,trapez_mu,rotatoren"],["facepulls","Face Pulls am Kabel","kg","schulter_h,rotatoren","rhomboiden,trapez_mu,nacken"],["aufrechtes-rudern","Aufrechtes Rudern","kg","schulter_s,nacken","schulter_v,bizeps"],["shrugs","Shrugs (Kurzhantel)","kg","nacken","trapez_mu,ua_beuger"],["klimmzuege","Klimmzüge","bw","latissimus,teres","rhomboiden,trapez_mu,schulter_h,bizeps,brachialis,ua_beuger"],["klimmzuege-eng","Klimmzüge eng (Untergriff)","bw","latissimus,bizeps","teres,brachialis,rhomboiden,trapez_mu"],["latzug","Latzug (breiter Griff)","kg","latissimus,teres","rhomboiden,trapez_mu,schulter_h,bizeps,brachialis"],["latzug-eng","Latzug eng (neutraler Griff)","kg","latissimus","teres,bizeps,brachialis,rhomboiden"],["lh-rudern","Langhantelrudern vorgebeugt","kg","latissimus,rhomboiden,trapez_mu","teres,schulter_h,bizeps,brachialis,ruecken_u,hams_a"],["kh-rudern","Kurzhantelrudern einarmig","kg","latissimus,rhomboiden","teres,trapez_mu,schulter_h,bizeps,brachialis"],["kabelrudern","Kabelrudern sitzend (enger Griff)","kg","latissimus,rhomboiden,trapez_mu","teres,schulter_h,bizeps,brachialis,ruecken_u"],["t-bar-rudern","T-Bar-Rudern","kg","rhomboiden,trapez_mu,latissimus","teres,schulter_h,bizeps,ruecken_u"],["maschinenrudern","Rudern an der Maschine","kg","rhomboiden,trapez_mu,latissimus","teres,schulter_h,bizeps"],["kabel-pullover","Kabel-Pullover (gestreckte Arme)","kg","latissimus","teres,trizeps_l"],["kreuzheben","Kreuzheben","kg","gluteus,ruecken_u,hams_a,hams_i","quad_vl,quad_vm,quad_rf,adduktoren,nacken,trapez_mu,ua_beuger"],["hyperextensions","Hyperextensions","bw","ruecken_u","gluteus,hams_a,hams_i"],["sz-curls","Langhantel-Curls (SZ-Stange)","kg","bizeps","brachialis,brachiorad"],["kh-curls","Kurzhantel-Curls","kg","bizeps","brachialis,brachiorad"],["hammer-curls","Hammer-Curls (Kurzhantel)","kg","brachialis,brachiorad","bizeps"],["schraegbank-curls","Schrägbank-Curls","kg","bizeps","brachialis"],["konzentrationscurls","Konzentrationscurls","kg","bizeps","brachialis"],["kabel-curls","Bizeps-Curls am Kabel","kg","bizeps","brachialis,brachiorad"],["scott-curls","Scott-Curls (Preacher)","kg","bizeps,brachialis","brachiorad"],["reverse-curls","Reverse Curls","kg","brachiorad,brachialis","ua_strecker,bizeps"],["handgelenk-curls","Handgelenk-Curls","kg","ua_beuger",""],["kniebeugen","Kniebeugen (Langhantel)","kg","quad_rf,quad_vl,quad_vm,gluteus","adduktoren,hams_a,hams_i,ruecken_u,soleus"],["frontkniebeugen","Frontkniebeugen","kg","quad_vl,quad_vm,quad_rf","gluteus,adduktoren,ruecken_u,bauch"],["goblet-squat","Goblet Squat","kg","quad_vl,quad_vm,quad_rf,gluteus","adduktoren,bauch"],["beinpresse","Beinpresse","kg","quad_vl,quad_vm,quad_rf,gluteus","adduktoren,hams_a,soleus"],["hackenschmidt","Hackenschmidt-Kniebeugen","kg","quad_vl,quad_vm,quad_rf","gluteus,adduktoren"],["ausfallschritte","Ausfallschritte","kg","quad_vl,quad_vm,quad_rf,gluteus","adduktoren,gluteus_m,hams_a,soleus"],["bulgarian","Bulgarische Split Squats","kg","quad_vl,quad_vm,gluteus","quad_rf,adduktoren,gluteus_m,hams_a"],["step-ups","Step-ups","kg","quad_vl,quad_vm,gluteus","quad_rf,gluteus_m,hams_a"],["beinstrecker","Beinstrecker","kg","quad_rf,quad_vl,quad_vm",""],["rdl","Rumänisches Kreuzheben","kg","hams_a,hams_i,gluteus","ruecken_u,adduktoren,ua_beuger,nacken"],["beinbeuger","Beinbeuger","kg","hams_a,hams_i","waden"],["beinbeuger-sitzend","Beinbeuger sitzend","kg","hams_a,hams_i","waden"],["hip-thrust","Hip Thrust","kg","gluteus","hams_a,hams_i,quad_vl,gluteus_m,adduktoren"],["abduktoren","Abduktoren (Maschine)","kg","gluteus_m","gluteus"],["adduktoren","Adduktoren (Maschine)","kg","adduktoren",""],["wadenheben","Wadenheben stehend","kg","waden","soleus"],["wadenheben-sitzend","Wadenheben sitzend","kg","soleus","waden"],["beinheben","Hängendes Beinheben","bw","hueftbeuger,bauch","bauch_s,quad_rf,ua_beuger"],["knieheben","Hängendes Knieheben","bw","hueftbeuger,bauch","bauch_s"],["plank","Plank","time","bauch","bauch_s,schulter_v,gluteus,quad_rf"],["seitstuetz","Seitstütz","time","bauch_s","gluteus_m,bauch"],["crunches","Crunches","bw","bauch","bauch_s"],["kabel-crunch","Kabel-Crunch","kg","bauch","bauch_s"],["russian-twist","Russian Twist","bw","bauch_s","bauch,hueftbeuger"],["ab-wheel","Ab Wheel Rollout","bw","bauch","bauch_s,latissimus,schulter_v,hueftbeuger"],["pallof","Pallof Press","kg","bauch_s","bauch"],["holzhacker","Holzhacker am Kabel","kg","bauch_s","bauch,schulter_v"],["burpees","Burpees","tr","quad_vl,quad_vm,brust_u,schulter_v,bauch","gluteus,trizeps_l,quad_rf,waden"],["mountain-climbers","Mountain Climbers","tr","bauch,hueftbeuger","schulter_v,brust_u,quad_rf"],["jumping-jacks","Jumping Jacks","tr","waden,schulter_s","gluteus_m,adduktoren,soleus"],["bear-crawl","Bear Crawl","tr","schulter_v,bauch","quad_vl,trizeps_l,brust_u"],["seilspringen","Seilspringen","time","waden,soleus","quad_vl,schulter_v,ua_beuger"],["kb-swings","Kettlebell Swings","kg","gluteus,hams_a,hams_i","ruecken_u,schulter_v,bauch"]];
const TONE_HEX = { y: '#fff200', m: '#ec008c', c: '#00aeef', g: '#3fd16b', r: '#ff4d3d', v: '#9b7bff' };
const normName = s => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9äöüß]+/g, ' ').trim();
EX_LIB.push(
  ['beinheben-stuetz', 'Beinheben im Stütz', 'bw', 'hueftbeuger,bauch', 'bauch_s,quad_rf,trizeps_l'],
  ['knieheben-stuetz', 'Knieheben im Stütz', 'bw', 'hueftbeuger,bauch', 'bauch_s,trizeps_l'],
  ['l-sit', 'L-Sit an der Dipstation', 'time', 'hueftbeuger,bauch', 'quad_rf,bauch_s,trizeps_l,latissimus,trapez_mu'],
  ['knie-liegestuetze', 'Knie-Liegestütze', 'bw', 'brust_u', 'brust_o,schulter_v,trizeps_s,trizeps_l'],
  ['schraege-liegestuetze', 'Schräge Liegestütze (Hände erhöht)', 'bw', 'brust_u', 'brust_o,schulter_v,trizeps_s'],
  ['erhoehte-liegestuetze', 'Liegestütze mit erhöhten Füßen', 'bw', 'brust_o', 'brust_u,schulter_v,trizeps_s,trizeps_l'],
  ['diamant-liegestuetze', 'Diamant-Liegestütze', 'bw', 'trizeps_s,trizeps_l', 'brust_u,schulter_v'],
  ['pike-liegestuetze', 'Pike-Liegestütze', 'bw', 'schulter_v', 'trizeps_s,trizeps_l,schulter_s,brust_o'],
  ['rudern-koerper', 'Rudern am Körper (Australian Pull-ups)', 'bw', 'latissimus,rhomboiden', 'trapez_mu,schulter_h,bizeps,brachialis'],
  ['kniebeuge-bw', 'Kniebeuge ohne Gewicht', 'bw', 'quad_vl,quad_vm', 'gluteus,adduktoren'],
  ['sprungkniebeugen', 'Sprungkniebeugen', 'bw', 'quad_vl,quad_vm,gluteus', 'waden,quad_rf'],
  ['glute-bridge', 'Glute Bridge', 'bw', 'gluteus', 'hams_a,hams_i,ruecken_u']
);
const LIB_BY_ID = Object.fromEntries(EX_LIB.map(e => [e[0], e]));
const KOND = new Set(['burpees', 'mountain-climbers', 'jumping-jacks', 'bear-crawl', 'seilspringen', 'kb-swings']);   // Gruppe „Kondition“
const TIMED_RANGE = { tr: [30, 45], time: [30, 60] };   // Vorgabe in Sekunden für neue Zeit-Übungen
const LIB_BY_NAME = Object.fromEntries(EX_LIB.map(e => [normName(e[1]), e]));
const csvMus = v => String(v || '').split(',').filter(k => BODY.names[k]);
// Muskeln aus der Bibliothek, passend zu Kennung oder Name der Übung
function libMuscles(id, name) {
  const e = LIB_BY_ID[id] || LIB_BY_NAME[normName(name)];
  return e ? { p: csvMus(e[3]), s: csvMus(e[4]) } : { p: [], s: [] };
}
/* ---------- Bibliothek ----------
   Alle Übungen, gemeinsam für beide. Startbestand aus der App, danach gilt das Blatt „Bibliothek“ der Tabelle
   und jede Änderung aus der App (Log-Eintrag „lib“). Pro Übung gewinnt der neueste Stand. */
// Standard-Sätze und -Spanne für Muskelaufbau (max. 15 Wdh., außer Bauch und Zeit)
const LIB_BIG = new Set(['bankdruecken', 'lh-schraegbank', 'military-press', 'klimmzuege', 'klimmzuege-eng', 'lh-rudern', 't-bar-rudern', 'kreuzheben', 'kniebeugen', 'frontkniebeugen']);
const LIB_MULTI = new Set(['kh-bankdruecken', 'schraegbank', 'negativbank', 'brustpresse', 'dips', 'enges-bankdruecken', 'schulterdruecken', 'latzug', 'latzug-eng', 'kh-rudern', 'kabelrudern', 'maschinenrudern', 'hackenschmidt', 'goblet-squat', 'beinpresse', 'ausfallschritte', 'bulgarian', 'step-ups', 'rdl', 'hip-thrust', 'hyperextensions', 'liegestuetze', 'bankdips', 'aufrechtes-rudern', 'kb-swings', 'knie-liegestuetze', 'schraege-liegestuetze', 'erhoehte-liegestuetze', 'diamant-liegestuetze', 'pike-liegestuetze', 'rudern-koerper', 'kniebeuge-bw', 'glute-bridge', 'sprungkniebeugen']);
const LIB_CORE = new Set(['beinheben', 'knieheben', 'crunches', 'kabel-crunch', 'russian-twist', 'ab-wheel', 'pallof', 'holzhacker', 'beinheben-stuetz', 'knieheben-stuetz']);
const LIB_SYN = { bankdruecken: 'Bench Press', kniebeugen: 'Squat', kreuzheben: 'Deadlift', klimmzuege: 'Pull-ups', 'klimmzuege-eng': 'Chin-ups', latzug: 'Lat Pulldown', 'beinheben-stuetz': "Captain's Chair", 'rudern-koerper': 'Inverted Row', rdl: 'RDL', 'military-press': 'Overhead Press', 'hip-thrust': 'Glute', 'l-sit': 'L-Sitz', burpees: 'Kondition', 'kb-swings': 'Kettlebell' };
function seedRange(id, type) {
  if (type === 'tr') return [3, 30, 45];
  if (type === 'time') return id === 'l-sit' ? [3, 15, 30] : [3, 30, 60];
  if (LIB_BIG.has(id)) return [4, 6, 10];
  if (LIB_MULTI.has(id)) return [3, 8, 12];
  if (LIB_CORE.has(id)) return [3, 10, 20];
  return [3, 10, 15];
}
const LIB_FIELDS = ['name', 'type', 'p', 's', 'kond', 'sets', 'min', 'max', 'cue', 'video', 'syn', 'hidden', 'del', 'into'];
const LIB_SEED = (() => {
  const cue = {};
  Object.values(DEFAULT_PLAN).forEach(d => d.exercises.forEach(x => { cue[x.id] = x.cue; }));
  const o = {};
  EX_LIB.forEach(e => { const [sets, min, max] = seedRange(e[0], e[2]); o[e[0]] = { id: e[0], name: e[1], type: e[2], p: csvMus(e[3]), s: csvMus(e[4]).filter(k => !csvMus(e[3]).includes(k)), kond: KOND.has(e[0]), sets, min, max, cue: cue[e[0]] || '', video: '', syn: LIB_SYN[e[0]] || '', hidden: false, del: false, into: '', ts: '', by: '', seed: true }; });
  return o;
})();
const TYPE_BY_LABEL = Object.fromEntries(Object.entries(TYPE_LABEL).map(([k, v]) => [normName(v), k]));
// Muskelnamen aus dem Blatt (deutsch, lateinisch oder Kennung) → Kennung
const MUS_BY_NAME = (() => { const o = {}; Object.entries(BODY.names).forEach(([k, [de, la]]) => { o[k] = k; o[de.toLowerCase()] = k; o[la.toLowerCase()] = k; }); return o; })();
function cleanLib(x, base) {
  const b = base || {};
  const type = TYPE_LABEL[x.type] ? x.type : (TYPE_LABEL[b.type] ? b.type : 'kg');
  const p = [...new Set((Array.isArray(x.p) ? x.p : b.p || []).filter(k => BODY.names[k]))];
  const sx = [...new Set((Array.isArray(x.s) ? x.s : b.s || []).filter(k => BODY.names[k] && !p.includes(k)))];
  const [ds, dmin, dmax] = seedRange(str(x.id, 64), type);
  const min = int(x.min) || int(b.min) || dmin;
  return {
    id: str(x.id || b.id, 64), name: str(x.name, 80).trim() || b.name || 'Übung', type, p, s: sx, kond: !!(x.kond ?? b.kond),
    sets: Math.min(10, int(x.sets) || int(b.sets) || ds), min, max: Math.max(min, int(x.max) || int(b.max) || dmax),
    cue: str(x.cue ?? b.cue ?? '', 1500), video: safeUrl(x.video ?? b.video), syn: str(x.syn ?? b.syn ?? '', 200),
    hidden: !!(x.hidden ?? b.hidden), del: !!(x.del ?? b.del), into: str(x.into ?? b.into ?? '', 64), ts: str(x.ts || '', 40), by: str(x.by || '', 20), seed: !!LIB_SEED[x.id || b.id],
    owner: x.owner !== undefined ? x.owner || null : b.owner || null, crew: x.crew !== undefined ? x.crew || null : b.crew || null
  };
}
// Zeile aus dem Blatt → Eintrag. Unbekannte Muskelnamen werden übersprungen und als Hinweis gesammelt.
function libFromRow(r, warn) {
  if (!r || typeof r !== 'object') return null;
  const id = str(r.id, 64).trim(); if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  // Namen mit Semikolon (oder Komma) getrennt. „Trizeps, langer Kopf“ enthält selbst ein Komma: dann zwei Teile zusammennehmen.
  const mus = (v, col) => {
    const tk = String(v || '').split(/[,;\n]+/).map(t => t.trim()).filter(Boolean), out = [];
    for (let i = 0; i < tk.length; i++) {
      const two = i + 1 < tk.length && MUS_BY_NAME[(tk[i] + ', ' + tk[i + 1]).toLowerCase()];
      if (two) { out.push(two); i++; continue; }
      const k = MUS_BY_NAME[tk[i].toLowerCase()]; if (k) out.push(k); else warn.push(`${r.name || id}: „${tk[i]}“ (${col})`);
    }
    return out;
  };
  const art = TYPE_BY_LABEL[normName(r.art)] || (TYPE_LABEL[r.art] ? r.art : '');
  if (r.art && !art) warn.push(`${r.name || id}: Art „${r.art}“ unbekannt`);
  const yes = v => v === true || /^(ja|x|true|wahr|1)$/i.test(String(v || '').trim());
  const into = str(r.zusammen, 80).trim();
  return { id, name: str(r.name, 80).trim(), type: art || undefined, p: mus(r.haupt, 'Hauptmuskeln'), s: mus(r.neben, 'Nebenmuskeln'), kond: /kondition/i.test(String(r.gruppe || '')),
    sets: int(r.saetze), min: int(r.von), max: int(r.bis), cue: String(r.ausfuehrung || ''), video: String(r.video || ''), syn: String(r.suche || ''), hidden: yes(r.ausgeblendet), into,
    ts: r.geaendert ? new Date(r.geaendert).toISOString() : '', by: str(r.vonPerson || '', 20), owner: r.owner || null, crew: r.crew || null };
}
// Eintrag → lesbare Zeile fürs Blatt (gleiche Reihenfolge wie die Spalten in Code.gs)
function libRow(L) {
  return [L.id, L.name, TYPE_LABEL[L.type], L.kond ? 'Kondition' : '', L.p.map(k => BODY.names[k][0]).join('; '), L.s.map(k => BODY.names[k][0]).join('; '),
    L.sets, L.min, L.max, L.cue || '', L.video || '', L.syn || '', !!L.hidden, L.into || ''];
}
let libSheet = (() => { try { return JSON.parse(localStorage.getItem('hb.lib.sheet') || 'null'); } catch (e) { return null; } })();
const libTarget = (lib, id) => { let k = id, n = 0; while (lib[k] && lib[k].into && lib[lib[k].into] && n++ < 6) k = lib[k].into; return k; };
function cleanMuscles(m) {
  if (!m || typeof m !== 'object' || (!Array.isArray(m.p) && !Array.isArray(m.s))) return null;
  const p = [...new Set((Array.isArray(m.p) ? m.p : []).filter(k => BODY.names[k]))];
  const s = [...new Set((Array.isArray(m.s) ? m.s : []).filter(k => BODY.names[k] && !p.includes(k)))];
  return { p, s };
}


/* ---------- Muskeln: Darstellung ---------- */
const mixHex = (a, b, t) => { const h = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)); const A = h(a), B2 = h(b); return '#' + A.map((v, i) => Math.round(v * t + B2[i] * (1 - t)).toString(16).padStart(2, '0')).join(''); };
const MUS_BASE = '#505057';
const musOf = x => {
  const lib = _st && _st.lib, L = x && lib && lib[libTarget(lib, x.id)];
  if (L && !L.del) return { p: L.p.slice(), s: L.s.slice() };
  return (x && x.muscles) || (x ? libMuscles(x.id, x.name) : { p: [], s: [] });
};
const musOrder = m => m.p.concat(m.s);
const musSoft = tk => mixHex(TONE_HEX[tk] || '#ffffff', MUS_BASE, 0.45);
// Körper als SVG; Nummern als runde Marken darüber (in % positioniert, skalieren mit)
function bodyFig(view, tk, m, o = {}) {
  const tone = TONE_HEX[tk] || '#ffffff', soft = musSoft(tk), v = view === 'front' ? 'f' : 'b', list = BODY[view === 'front' ? 'front' : 'back'];
  const order = musOrder(m), side = o.side || 'auto', w = o.w || 150, lr = o.lr ?? 9;
  const d = Math.max(14, Math.round(lr * 2 * w / 200)), fs = Math.max(8.5, Math.round(d * 6) / 10);
  const paths = list.map(([k, dd]) => `<path class="m" data-m="${k}" d="${dd}" fill="${m.p.includes(k) ? tone : m.s.includes(k) ? soft : MUS_BASE}"/>`).join('');
  const lines = view === 'front' ? '<path class="ln" d="M86,146H114M85,166H115M86,186H114M100,127V216"/>' : '<path class="ln" d="M100,150V214"/>';
  const labs = o.nums === false ? '' : list.filter(([k]) => order.includes(k) && (o.allLabels || !LABEL_VIEW[k] || LABEL_VIEW[k] === view)).map(([k, , x, y]) => {
    const rx = side === 'right' || (side === 'auto' && BODY.right[v].includes(k)) ? 200 - x : x;
    return `<span class="mlab" style="left:${rx / 2}%;top:${Math.round(y / 4.4 * 100) / 100}%;width:${d}px;height:${d}px;font-size:${fs}px">${order.indexOf(k) + 1}</span>`;
  }).join('');
  return `<div class="bodyfig" style="width:${w}px"><svg viewBox="0 0 200 440" role="img" aria-label="${view === 'front' ? 'Vorderseite' : 'Rückseite'}: ${esc(order.map((k, i) => `${i + 1} ${BODY.names[k][0]}`).join(', ') || 'keine Muskeln')}"><path d="${BODY.sil}" fill="#38383d"/><ellipse cx="100" cy="30" rx="17" ry="22" fill="#38383d"/>${paths}${lines}</svg>${labs}</div>`;
}
// Muskeln, die vorne und hinten zu sehen sind, bekommen ihre Nummer nur auf der Seite, wo sie hauptsächlich liegen
const LABEL_VIEW = { latissimus: 'back', nacken: 'back', schulter_s: 'front', bauch_s: 'front', gluteus_m: 'back', quad_vl: 'front', adduktoren: 'front', waden: 'back', soleus: 'back' };
const FRONT_IDS = new Set(BODY.front.map(f => f[0])), BACK_IDS = new Set(BODY.back.map(f => f[0]));
const bestView = m => { const f = m.p.filter(k => FRONT_IDS.has(k) && !BACK_IDS.has(k)).length, b = m.p.filter(k => BACK_IDS.has(k) && !FRONT_IDS.has(k)).length; return b > f ? 'back' : 'front'; };
function musLegend(m, tk) {
  const order = musOrder(m);
  if (!order.length) return '<div class="small muted">Noch keine Muskeln eingetragen.</div>';
  return `<ol class="mleg">${order.map((k, i) => { const main = m.p.includes(k); return `<li><span class="mnum">${i + 1}</span><span class="mn">${esc(BODY.names[k][0])} <small>${esc(BODY.names[k][1])}</small></span><span class="mrole${main ? ' main' : ''}" style="${main ? `color:${TONE_HEX[tk] || '#fff'}` : ''}">${main ? 'Haupt' : 'Neben'}</span></li>`; }).join('')}</ol>`;
}
const musSwatches = tk => `<div class="msw"><span><i style="background:${TONE_HEX[tk] || '#fff'}"></i>Hauptmuskel</span><span><i style="background:${musSoft(tk)}"></i>Nebenmuskel</span></div>`;
function musBlock(x, tk) {
  const m = musOf(x);
  if (!musOrder(m).length) return `<div class="small muted">Für diese Übung sind noch keine Muskeln hinterlegt. Ergänzen unter Plan → Bibliothek.</div>`;
  return `<div class="musbox"><button type="button" class="musfigs" data-act="mus-full" data-ex="${esc(x.id)}" data-tone="${tk}" aria-label="Muskeln im Vollbild öffnen">
      <span class="mcol">${bodyFig('front', tk, m)}<span class="eyebrow">Vorne</span></span>
      <span class="mcol">${bodyFig('back', tk, m)}<span class="eyebrow">Hinten</span></span>
      <span class="mexp">${ICON.expand}</span></button>
    ${musSwatches(tk)}${musLegend(m, tk)}</div>`;
}
// Übung zu einer Kennung finden (laufendes Training, Builder, Pläne)
function exById(id) {
  if (draft) { const it = draft.items.find(it => it.ex.id === id); if (it) return it.ex; }
  if (builder) for (const d of PD(builder.work)) { const x = builder.work[d].exercises.find(y => y.id === id); if (x) return x; }
  for (const pl of [planOf(cfg.me, 'mine'), planOf(cfg.me), planOf(partner())]) for (const d of PD(pl)) { const x = pl[d].exercises.find(y => y.id === id); if (x) return x; }
  return null;
}
/* Zoom mit zwei Fingern (und Verschieben mit einem Finger, wenn gezoomt). onTap bekommt das angetippte Element. */
function attachZoom(stage, wrap, pill, onTap) {
  let sc = 1, tx = 0, ty = 0, g = null, lastTap = 0;
  const pts = new Map();
  const apply = () => {
    const r = stage.getBoundingClientRect();
    sc = Math.min(4, Math.max(1, sc));
    tx = Math.min(0, Math.max(r.width * (1 - sc), tx)); ty = Math.min(0, Math.max(r.height * (1 - sc), ty));
    wrap.style.transform = `translate(${tx}px,${ty}px) scale(${sc})`;
    if (pill) pill.textContent = sc.toFixed(1).replace('.', ',') + '×';
  };
  const local = e => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  stage.addEventListener('pointerdown', e => {
    pts.set(e.pointerId, local(e)); try { stage.setPointerCapture(e.pointerId); } catch (er) {}
    const a = [...pts.values()];
    if (a.length === 2) g = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), s: sc, tx, ty, mx: (a[0].x + a[1].x) / 2, my: (a[0].y + a[1].y) / 2, pinch: true };
    else if (a.length === 1) g = { x: a[0].x, y: a[0].y, tx, ty, t: Date.now(), moved: false, pinch: false, cx: e.clientX, cy: e.clientY };
  });
  stage.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !g) return;
    pts.set(e.pointerId, local(e));
    const a = [...pts.values()];
    if (g.pinch && a.length >= 2) {
      const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2;
      const ns = Math.min(4, Math.max(1, g.s * d / g.d));
      tx = mx - (g.mx - g.tx) * ns / g.s; ty = my - (g.my - g.ty) * ns / g.s; sc = ns; apply();
    } else if (!g.pinch && a.length === 1) {
      const dx = a[0].x - g.x, dy = a[0].y - g.y;
      if (Math.abs(dx) + Math.abs(dy) > 8) g.moved = true;
      if (sc > 1 && g.moved) { tx = g.tx + dx; ty = g.ty + dy; apply(); }
    }
  });
  const end = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (g && !g.pinch && !g.moved && e.type === 'pointerup' && Date.now() - g.t < 500) {
      const now = Date.now();
      if (!onTap && now - lastTap < 320) { sc = 1; tx = ty = 0; apply(); }
      lastTap = now;
      if (onTap) onTap(document.elementFromPoint(g.cx, g.cy));
    }
    if (!pts.size) g = null; else if (g && g.pinch) g = null;
  };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  return { reset: () => { sc = 1; tx = ty = 0; apply(); } };
}
function openMusFull(x, tk) {
  const m = musOf(x), order = musOrder(m);
  const chips = order.map((k, i) => `<span class="mchip${m.p.includes(k) ? '' : ' soft'}" style="background:${m.p.includes(k) ? TONE_HEX[tk] : musSoft(tk)};color:${m.p.includes(k) && tk !== 'm' ? '#000' : '#fff'}"><b>${i + 1}</b>${esc(BODY.names[k][0])}</span>`).join('');
  $('#modal').innerHTML = `<div class="backdrop" data-act="mclose-bg"><div class="sheet full musfull" role="dialog" aria-modal="true" aria-label="Muskeln: ${esc(x.name)}">
    <div class="mf-top"><button class="iconbtn glass" data-act="mclose" aria-label="Schließen">${ICON.x}</button><div class="mf-t"><span class="eyebrow" style="color:${TONE_HEX[tk] || '#fff'}">Muskeln</span><b>${esc(x.name)}</b></div><span style="width:44px"></span></div>
    <div class="mf-ctl"><div class="seg2" role="group" aria-label="Ansicht"><button data-act="mf-side" data-v="f" aria-pressed="true">Vorne</button><button data-act="mf-side" data-v="b" aria-pressed="false">Hinten</button></div><span class="zpill" id="mf-z">1,0×</span></div>
    <div class="zstage" id="mf-stage"><div class="zwrap" id="mf-wrap"><div class="flip" id="mf-flip"><div class="face">${bodyFig('front', tk, m, { w: 230, lr: 8 })}</div><div class="face bk">${bodyFig('back', tk, m, { w: 230, lr: 8 })}</div></div></div></div>
    <div class="small muted" style="text-align:center">2 Finger zum Zoomen · doppelt tippen setzt zurück</div>
    <div class="mchips">${chips || '<span class="small muted">Keine Muskeln hinterlegt.</span>'}</div>
  </div></div>`;
  attachZoom($('#mf-stage'), $('#mf-wrap'), $('#mf-z'));
}
/* Muskel-Editor im Plan-Builder: 1× tippen Haupt, 2× Neben, 3× aus */
let musEd = null;
function openMusEditor() {
  const inp = $('#f-muscles'), host = $('#libform') || $('#exform'); if (!inp || !host) return;
  let m; try { m = cleanMuscles(JSON.parse(inp.value)); } catch (e) { m = null; }
  musEd = { m: m || { p: [], s: [] }, view: bestView(m || { p: [], s: [] }), tk: (LF && LF.tk) || (builder && DAY_TONE[builder.day]) || 'y', q: '' };
  const ov = document.createElement('div');
  ov.className = 'museditor'; ov.id = 'museditor';
  ov.innerHTML = `<div class="me-top"><button type="button" class="linkbtn" data-act="me-cancel">Abbrechen</button><div class="mf-t"><b>Muskeln wählen</b><span class="eyebrow" style="color:${TONE_HEX[musEd.tk]}">${esc(($('#lf-name') || {}).value || 'Neue Übung')}</span></div><button type="button" class="btn small primary" data-act="me-done">Fertig</button></div>
    <div class="mf-ctl"><div class="seg2" role="group" aria-label="Ansicht"><button type="button" data-act="me-side" data-v="front" aria-pressed="true">Vorne</button><button type="button" data-act="me-side" data-v="back" aria-pressed="false">Hinten</button></div><span class="zpill" id="me-z">1,0×</span></div>
    <div class="zstage me-stage" id="me-stage"><div class="zwrap" id="me-wrap"></div></div>
    <div class="msw me-hint"><span><i style="background:${TONE_HEX[musEd.tk]}"></i>1× Haupt</span><span><i style="background:${musSoft(musEd.tk)}"></i>2× Neben</span><span><i style="background:${MUS_BASE}"></i>3× aus</span></div>
    <div class="me-search"><span class="swsearch">${ICON.search}<input class="inp" id="me-q" autocomplete="off" placeholder="Muskel suchen, z. B. Lat, Trizeps, Po" aria-label="Muskel suchen"></span><div id="me-hits" class="chips"></div></div>
    <div id="me-leg" class="me-leg"></div>`;
  ($('#modal') || host).appendChild(ov);
  musEdRender();
  attachZoom($('#me-stage'), $('#me-wrap'), $('#me-z'), el => {
    const k = el && el.closest && el.closest('[data-m]') && el.closest('[data-m]').dataset.m;
    if (k) musCycle(k);
  });
}
function musCycle(k) {
  const m2 = musEd.m;
  if (m2.p.includes(k)) { m2.p = m2.p.filter(y => y !== k); m2.s.push(k); }
  else if (m2.s.includes(k)) m2.s = m2.s.filter(y => y !== k);
  else m2.p.push(k);
  musEdRender();
}
// Muskelsuche: deutsch, lateinisch, Umgangssprache und Gruppen
const MUS_SYN = { lat: ['latissimus'], 'breiter rücken': ['latissimus'], po: ['gluteus', 'gluteus_m'], gesäß: ['gluteus', 'gluteus_m'], hintern: ['gluteus'], sixpack: ['bauch'], 'seitlicher bauch': ['bauch_s'], seite: ['bauch_s', 'serratus'], waden: ['waden', 'soleus'], wade: ['waden', 'soleus'], trizeps: ['trizeps_l', 'trizeps_s'], bizeps: ['bizeps', 'brachialis'], delta: ['schulter_v', 'schulter_s', 'schulter_h'], quadrizeps: ['quad_rf', 'quad_vl', 'quad_vm'], quads: ['quad_rf', 'quad_vl', 'quad_vm'], oberschenkel: ['quad_rf', 'quad_vl', 'quad_vm', 'hams_a', 'hams_i', 'adduktoren'], hamstrings: ['hams_a', 'hams_i'], beinbizeps: ['hams_a', 'hams_i'], unterarm: ['ua_beuger', 'ua_strecker', 'brachiorad'], trapez: ['nacken', 'trapez_mu'], 'unterer rücken': ['ruecken_u'], 'oberer rücken': ['trapez_mu', 'rhomboiden', 'teres'], hüfte: ['hueftbeuger', 'gluteus_m'], abduktoren: ['gluteus_m'], innenschenkel: ['adduktoren'], schienbein: ['schienbein'] };
function musFind(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const out = new Set();
  Object.entries(MUS_SYN).forEach(([w, ks]) => { if (w.includes(q) || (q.length >= 3 && q.includes(w))) ks.forEach(k => out.add(k)); });
  Object.entries(BODY.groups).forEach(([g, ks]) => { if (g.toLowerCase().startsWith(q)) ks.forEach(k => out.add(k)); });
  Object.entries(BODY.names).forEach(([k, [de, la]]) => { if (de.toLowerCase().includes(q) || la.toLowerCase().includes(q) || k.includes(q)) out.add(k); });
  return [...out].slice(0, 14);
}
function musHits() {
  const box = $('#me-hits'); if (!box || !musEd) return;
  const ks = musFind(musEd.q || '');
  box.innerHTML = musEd.q && !ks.length ? '<span class="small muted">Kein Muskel gefunden.</span>' : ks.map(k => { const st_ = musEd.m.p.includes(k) ? 'Haupt' : musEd.m.s.includes(k) ? 'Neben' : ''; return `<button type="button" class="pchip ${st_ ? 'mon' : ''}" data-act="me-pick" data-m="${k}" aria-pressed="${!!st_}" style="${st_ === 'Haupt' ? `background:${TONE_HEX[musEd.tk]};color:${musEd.tk === 'm' ? '#fff' : '#000'};border-color:transparent` : st_ === 'Neben' ? `background:${musSoft(musEd.tk)};color:#fff;border-color:transparent` : ''}">${esc(BODY.names[k][0])}${st_ ? ` · ${st_}` : ''}</button>`; }).join('');
}
function musEdRender(flash) {
  $('#me-wrap').innerHTML = `<div class="me-fig">${bodyFig(musEd.view, musEd.tk, musEd.m, { w: 260, lr: 7, allLabels: true })}</div>`;
  $('#me-leg').innerHTML = musLegend(musEd.m, musEd.tk);
  document.querySelectorAll('[data-act="me-side"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === musEd.view)));
  if (flash) document.querySelectorAll(`#me-wrap [data-m="${flash}"]`).forEach(el => el.classList.add('flash'));
  musHits();
}
function musPreview(m, tk) {
  const order = musOrder(m);
  return `<div class="mprev">${bodyFig('front', tk, m, { w: 64, nums: false })}${bodyFig('back', tk, m, { w: 64, nums: false })}
    <span class="mptxt">${order.length ? `<b>Haupt:</b> ${esc(m.p.map(k => BODY.names[k][0]).join(', ') || '–')}<br><b>Neben:</b> ${esc(m.s.map(k => BODY.names[k][0]).join(', ') || '–')}` : '<span class="muted">Noch keine Muskeln. Tippe auf „Muskeln bearbeiten“.</span>'}</span></div>`;
}

/* ---------- Hilfsfunktionen ---------- */
const isEmoji = v => typeof v === 'string' && v.length > 0 && v.length <= 16 && /\p{Extended_Pictographic}/u.test(v) && !/[\s<>&"'`A-Za-z0-9]/.test(v);
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => (self.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const int = v => { const n = parseInt(String(v ?? ''), 10); return isFinite(n) && n > 0 ? n : 0; };
const fmtN = n => (Math.round(n * 100) / 100).toLocaleString('de-DE');
const fmtIn = n => (n == null || n === '' ? '' : String(Math.round(Math.abs(n) * 100) / 100).replace('.', ','));
const fmtSigned = w => (w > 0 ? '+' : w < 0 ? '−' : '') + fmtN(Math.abs(w)) + ' kg';
const fmtDate = iso => new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const fmtLong = iso => new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtTime = iso => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const gen = p => (/s$/.test(p) ? p + "'" : p + 's');
const partner = () => PEOPLE.find(p => p !== cfg.me);
const others = () => PEOPLE.filter(p => p !== cfg.me);   // alle Gym Buddys (heute nur einer, später mehr)
const sum = a => a.reduce((x, y) => x + y, 0);
const avg = a => (a.length ? sum(a) / a.length : 0);
const roundTo = (v, step) => { const s = step > 0 ? step : 2.5; return Math.round(Math.round(v / s) * s * 100) / 100; };
const stepOf = x => (x.step > 0 ? x.step : 2.5);
// Ohne eigenen Link: YouTube-Suche nach Shorts zur Ausführung (Klammerzusätze wie „(Langhantel)“ bleiben für die Suche weg)
const videoUrl = x => x.video || 'https://www.youtube.com/results?search_query=' + encodeURIComponent(x.name.replace(/\s*\(.*?\)/g, '').trim() + ' Ausführung #shorts');
const pad2 = n => String(n).padStart(2, '0');
const dateKey = v => { const d = new Date(v); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const todayStr = () => dateKey(new Date());
const weekKey = v => { const d = new Date(v); return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7)); };
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'uebung';
function relDay(iso) {
  const d = new Date(iso), t = new Date();
  const n = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  return n <= 0 ? 'heute' : n === 1 ? 'gestern' : n < 7 ? `vor ${n} Tagen` : fmtDate(iso);
}
function duration(a, b) { const m = Math.max(1, Math.round((new Date(b) - new Date(a)) / 60000)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; }
/* ---------- Flammen & Wochenstreak ----------
   Jedes abgeschlossene Training ist eine Flamme seines Tages. Drei Trainings in einer Kalenderwoche (Mo–So) ergeben eine Wochenflamme.
   Die Wochenstreak zählt die Wochen in Folge mit mindestens drei Trainings; die laufende Woche bricht sie erst, wenn sie ohne drei Trainings endet. */
const FLAME = { A: 'flammen/flamme-a.webp', B: 'flammen/flamme-b.webp', C: 'flammen/flamme-c.webp', D: 'flammen/flamme-d.webp', E: 'flammen/flamme-e.webp', F: 'flammen/flamme-f.webp', W: 'flammen/flamme-woche.webp' };
const FLAME_HERO = { A: 'flammen/flamme-hero-a.webp', B: 'flammen/flamme-hero-b.webp', C: 'flammen/flamme-hero-c.webp', D: 'flammen/flamme-hero-d.webp', E: 'flammen/flamme-hero-e.webp', F: 'flammen/flamme-hero-f.webp', W: 'flammen/flamme-hero-woche.webp' };
function weekOf(ts) { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7).getTime(); }
function prevWeek(k) { const d = new Date(k); d.setDate(d.getDate() - 7); return d.getTime(); }
function isoWeek(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 864e5 - 3 + (w1.getDay() + 6) % 7) / 7);
}
function flameStats(p) {
  const ws = st().workouts.filter(w => w.person === p).sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const counts = Object.fromEntries(DAYS.map(d => [d, 0])), perWeek = new Map();
  ws.forEach(w => { counts[w.data.day]++; const k = weekOf(w.ts); if (!perWeek.has(k)) perWeek.set(k, []); perWeek.get(k).push(w); });
  // Wochenflamme: so viele Trainings wie das persönliche Wochenziel dieser Woche (Änderungen gelten ab dem nächsten Montag).
  // Pausentage verkleinern das Ziel anteilig (abgerundet). Ziel 0 ohne Training: Woche eingefroren, zählt nicht und bricht nichts.
  const cur = weekOf(Date.now()), cnt = k => (perWeek.get(k) || []).length;
  const full = k => { const g = effGoal(p, k); return g === 0 ? cnt(k) > 0 : cnt(k) >= g; };
  const frozen = k => effGoal(p, k) === 0 && cnt(k) === 0;
  let k = full(cur) ? cur : prevWeek(cur), streak = 0, guard = 0;
  while (guard++ < 600) { if (full(k)) streak++; else if (!frozen(k)) break; k = prevWeek(k); }
  // Andere: Pausen sind oft privat. Dann gilt die Zahl, die ihr Handy selbst berechnet und im Profil gespeichert hat.
  if (p !== cfg.me) { const pr = PROFILES[p] || {}; if (+pr.flame > streak && pr.flame_week && String(pr.flame_week).slice(0, 10) >= dateKey(prevWeek(cur))) streak = +pr.flame; }
  return { counts, streak, week: perWeek.get(cur) || [], goal: effGoal(p, cur), base: weekGoal(p, cur), pauseDays: pauseDaysInWeek(p, cur) };
}
/* ---------- Pause (krank, verletzt, Urlaub, Sonstiges) ----------
   Eine Pause ist ein privates Ereignis „pause“ (pid, from, to, Grund). Wer „Pause mit Buddys teilen“ eingeschaltet hat,
   schreibt dazu eine öffentliche Kopie ohne Grund. Spätere Ereignisse mit derselben pid ersetzen frühere. */
const PZ_REASON = {
  krank: { label: 'Krank', health: true, icon: 'thermo', title: 'Gute Besserung' },
  verletzt: { label: 'Verletzt', health: true, icon: 'plaster', title: 'Werd schnell wieder fit' },
  urlaub: { label: 'Urlaub', icon: 'umbrella', title: 'Schönen Urlaub' },
  sonst: { label: 'Sonstiges', icon: 'moon', title: 'Gönn dir die Pause' }
};
const dayNum = s => Math.round(new Date(s + 'T12:00').getTime() / 864e5);
const addDays = (s, n) => dateKey(new Date(new Date(s + 'T12:00').getTime() + n * 864e5));
const pzDate = s => { const d = new Date(s + 'T12:00'); return `${d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '')}, ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.`; };
function pausesOf(p) { const m = st().pauses[p]; return m ? Object.values(m).filter(Boolean).sort((a, b) => a.from.localeCompare(b.from)) : []; }
function pauseOn(p, ds) { return pausesOf(p).find(x => x.from <= ds && ds <= x.to) || null; }
function pauseDaysInWeek(p, wk) { if (!pausesOf(p).length) return 0; const mon = dateKey(wk); let n = 0; for (let i = 0; i < 7; i++) if (pauseOn(p, addDays(mon, i))) n++; return n; }
function effGoal(p, wk) { const g = weekGoal(p, wk), pd = pauseDaysInWeek(p, wk); return pd ? Math.floor(g * (7 - pd) / 7) : g; }
const sharePause = () => !!(PROFILES[cfg.me] || {}).share_pause;
// Grund nur zeigen, wenn erlaubt: Gesundheitsgründe brauchen die Einwilligung
const pzReason = x => { const r = x && PZ_REASON[x.reason]; return r && (!r.health || hasConsent('health')) ? r : null; };
function savePause(z) {
  const pid = z.pid || 'pz-' + uid().slice(0, 12);
  const base = { pid, from: z.from, to: z.to, ...(z.deleted ? { deleted: true } : {}) };
  const r = PZ_REASON[z.reason] && (!PZ_REASON[z.reason].health || hasConsent('health')) ? z.reason : '';
  addEvent('pause', { ...base, ...(r ? { reason: r } : {}) }, z.deleted ? 'Pause gelöscht' : `Pause ${pzDate(z.from)} bis ${pzDate(z.to)}${r ? ' · ' + PZ_REASON[r].label : ''}`, { private: true });
  if (sharePause()) addEvent('pause', { ...base, mirror: true }, z.deleted ? 'Pause gelöscht' : `Pause bis ${pzDate(z.to)}`);
  return pid;
}
// Teilen ein/aus: öffentliche Kopien aller eigenen Pausen anlegen bzw. zurückziehen
function pauseMirrors(on) { pausesOf(cfg.me).forEach(x => addEvent('pause', { pid: x.pid, from: x.from, to: x.to, mirror: true, ...(on ? {} : { deleted: true }) }, on ? `Pause bis ${pzDate(x.to)}` : 'Pause nicht mehr geteilt')); }
// Training an einem Pausentag beendet die Pause ab heute
function endPauseToday() {
  const t = todayStr(), ap = pauseOn(cfg.me, t); if (!ap) return;
  const y = addDays(t, -1);
  savePause(ap.from <= y ? { ...ap, to: y } : { ...ap, deleted: true });
}
// Eigene Flammenzahl im Profil speichern, damit Buddys sie auch ohne sichtbare Pausen richtig sehen
let flamePushing = false;
function pushFlame() {
  const pr = PROFILES[cfg.me]; if (!sb || !pr || flamePushing) return;
  const n = flameStats(cfg.me).streak, wk = dateKey(weekOf(Date.now()));
  if (+pr.flame === n && String(pr.flame_week || '').slice(0, 10) === wk) return;
  flamePushing = true;
  sb.from('profiles').update({ flame: n, flame_week: wk }).eq('id', cfg.me).then(r => { flamePushing = false; if (!r.error) { pr.flame = n; pr.flame_week = wk; } }, () => { flamePushing = false; });
}
const flameImg = (p, size) => `<img src="${FLAME.W}" alt=""${pauseOn(p, todayStr()) ? ' class="pz-gray"' : ''}${size ? ` width="${size}" height="${size}"` : ''}>`;
/* Flammen-Liste: je Person Wochenflamme mit Streak, Antippen klappt die Tagesflammen auf */
const FLAME_OPEN = new Set();
function flameList() {
  const ppl = PEOPLE.map(p => ({ p, x: flameStats(p) })).sort((a, b) => b.x.streak - a.x.streak || (a.p === cfg.me ? -1 : 1));
  const rows = ppl.map(({ p, x }) => {
    const open = FLAME_OPEN.has(p), n = x.week.length, g = x.goal, ap = pauseOn(p, todayStr());
    const wk = ap ? `Pause bis ${pzDate(ap.to)}` : g === 0 ? 'Pause · Woche eingefroren' : n >= g ? `${n}/${g} · Wochenflamme sicher` : `${n}/${g} diese Woche`;
    return `<div class="fl-row"><button class="fl-head" data-act="fl-toggle" data-p="${esc(p)}" aria-expanded="${open}">${avatar(p, 36)}<span class="fl-who"><b>${p === cfg.me ? 'Du' : nm(p)}</b><span class="small muted">${wk}</span></span><span class="fl-n" aria-label="${x.streak} ${x.streak === 1 ? 'Woche' : 'Wochen'} Streak">${flameImg(p)}<b>${x.streak}</b></span></button>
      ${open ? `<div class="fl-days">${DAYS.filter(d => x.counts[d] || pdays(p).includes(d)).map(d => `<span class="fl-day"><img src="${FLAME[d]}" alt=""><span class="fl-k" style="color:${TONE_HEX[DAY_TONE[d]]}">${esc(dl(d, p))}</span><b class="mono">${x.counts[d]}</b></span>`).join('')}</div>` : ''}</div>`;
  }).join('');
  return `<div class="sec-title" id="flammen"><h2>Flammen</h2></div><section class="card fl-list">${rows}</section>`;
}
function viewDone(id) {
  const s = st(), w = s.workouts.find(x => x.id === id);
  if (!w) return null;
  const p = w.person, d = w.data.day, wk = weekOf(w.ts);
  const week = s.workouts.filter(x => x.person === p && weekOf(x.ts) === wk).sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const g = Math.max(1, effGoal(p, wk)), n = week.findIndex(x => x.id === id) + 1, full = n === g;
  const wort = k => ['', 'einem', 'zwei', 'drei', 'vier', 'fünf', 'sechs'][k] || k, rest = g - n;
  const streak = flameStats(p).streak;
  const wd = new Date(w.ts).toLocaleDateString('de-DE', { weekday: 'long' });
  const head = full
    ? `<h1 class="display done-t">Woche<br>geschafft</h1>
       <div class="mono done-s"><b>Wochenstreak ${streak}</b></div>
       <div class="mono muted small done-l">${streak > 1 ? `${streak} Wochen in Folge mit ${g === 1 ? 'einem Training' : wort(g) + ' Trainings'}` : 'Deine erste Woche mit erreichtem Wochenziel'}</div>`
    : `<h1 class="display done-k t-${DAY_TONE[d]}">${esc(wlabel(w))}</h1>
       <div class="done-s">${esc(w.data.title)}</div>
       <div class="mono muted small done-l">${n < g ? `${n} von ${g} diese Woche · noch ${rest === 1 ? 'eins' : wort(rest)} bis zur Wochenflamme` : `${n}. Training diese Woche · Wochenflamme schon sicher`}</div>`;
  const abTxt = w.abort ? `<div class="mono small done-ab">Abgebrochen · ${w.abort.done} von ${w.abort.plan} Sätzen</div>` : '';
  const slots = week.slice(0, Math.max(g, Math.min(n, 6))).map(x => `<div class="done-slot"><div class="glass${x.id === id ? ' new' : ''}"><img src="${FLAME[x.data.day]}" alt="${esc(dl(x.data.day, p))}"></div><span class="eyebrow">${new Date(x.ts).toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '')}</span></div>`);
  while (slots.length < g) slots.push('<div class="done-slot"><div class="empty-slot"></div><span class="eyebrow">·</span></div>');
  return `<div class="done">
    <div class="done-top"><span class="eyebrow">${esc(wd)} · KW ${isoWeek(w.ts)}</span><a class="iconbtn glass" href="#start" aria-label="Schließen">${ICON.x}</a></div>
    <img class="done-hero" src="${full ? FLAME_HERO.W : FLAME_HERO[d]}" alt="${full ? 'Wochenflamme' : 'Flamme für ' + esc(dl(d, p))}">
    ${head}${abTxt}
    <div class="done-bar">${slots.join('')}</div>
    <a class="btn primary done-go" href="#start">Weiter</a>
  </div>`;
}
function weekStart() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7); }

// Tageskürzel (z. B. B&T) und Tagesfarbe
const dl = (d, p, k) => { p = p || cfg.me; const pl = (k === 'mine' ? planOf(p, 'mine') : st().plans[p] || {})[d] || planOf(p, 'mine')[d]; return (pl && pl.short) || DAY_SHORT[d]; };
// Kürzel eines Trainings: ab 3.0 im Training gespeichert (Mein Plan anderer ist nicht sichtbar), sonst aus dem Plan
const wlabel = w => (w && w.data && w.data.short) || dl(w.data.day, w.person, w.data.plan);
const dayChip = (d, p, extra = '', k) => `<span class="day t-${DAY_TONE[d]} ${extra}">${esc(dl(d, p, k))}</span>`;
// Avatar: Profilbild oder Glas mit weißem Buchstaben
/* Profilbild-Ersatz und Chat-Namen: je Person ein fester, entsättigter Ton aus Cyan, Magenta oder Gelb.
   Heute aus dem Namen abgeleitet, ab 3.0 aus der Buddy-ID. Zwei Personen bekommen nie denselben Ton. */
const AV_FILL = ['#6b6528', '#2f5f6e', '#6e2f55', '#4a7280', '#84506d', '#7d7740'];
const AV_TEXT = ['#d6cf7c', '#7fb6c6', '#d08fb6', '#a3c9d4', '#e3b3cf', '#e9e3a8'];
let _avIdx = null;
function avIdx(p) {
  if (!_avIdx) {
    _avIdx = {}; const used = new Set();
    PEOPLE.forEach(q => { let h = 0; for (const ch of q) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0; let i = h % 6; while (used.has(i) && used.size < 6) i = (i + 1) % 6; used.add(i); _avIdx[q] = i; });
  }
  return _avIdx[p] ?? 0;
}
const nameColor = p => AV_TEXT[avIdx(p)];
function avatar(p, size = 32) {
  const img = st().avatars[p];
  const st_ = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`;
  return img ? `<img class="av" src="${esc(img)}" alt="${nm(p)}" style="${st_}">` : `<span class="av" style="${st_};background:${AV_FILL[avIdx(p)]}" aria-hidden="true">${esc((pname(p)[0] || '?').toUpperCase())}</span>`;
}

const ICON = {
  qr: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/></svg>',
  more: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  book: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 0 2 2h13v-4"/><path d="M9 7h6"/></svg>',
  pen: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  mail: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  copy: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  hourglass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12M6 21h12"/><path d="M7.5 3v1.5c0 3 4.5 4.5 4.5 7.5 0-3 4.5-4.5 4.5-7.5V3M7.5 21v-1.5c0-3 4.5-4.5 4.5-7.5 0 3 4.5 4.5 4.5 7.5V21"/></svg>',
  thermo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 14.6V5a2 2 0 0 0-4 0v9.6a4 4 0 1 0 4 0z"/><path d="M12 10v7"/></svg>',
  plaster: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="rotate(-45 12 12)"><rect x="2" y="8" width="20" height="8" rx="4"/><path d="M9 8v8M15 8v8"/></g></svg>',
  umbrella: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9z"/><path d="M12 12v6.5a2 2 0 0 0 4 0"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  left: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  swap: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4 3 8l4 4"/><path d="M3 8h13"/><path d="m17 20 4-4-4-4"/><path d="M21 16H8"/></svg>',
  sync: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/></svg>',
  lock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  cam: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  key: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2.5 2.5"/></svg>',
  eye: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  img: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>',
  flip: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/></svg>',
  barT: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="2.5" y="7" width="19" height="10" rx="1.5"/><path d="M8 12h8"/></svg>',
  dl: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  expand: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
  warn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/></svg>',
  trophy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
  chat: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  send: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  emoplus: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 11.5A8.5 8.5 0 1 1 12.5 3.5"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/><path d="M19 2v6M16 5h6"/></svg>',
  bubble: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13"/></svg>',
  del: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12z"/><path d="m16 9-5 6M11 9l5 6"/></svg>'
};

/* ---------- Lokaler Speicher ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('hb.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('hb.' + k, JSON.stringify(v)); } catch (e) { toast('Speichern auf dem Handy fehlgeschlagen. Ist der Speicher voll?'); } }
};
let cfg = LS.get('cfg', { me: null, url: '', key: '' });
let events = LS.get('events', []);
let pending = LS.get('pending', []);
let lastSeq = LS.get('lastSeq', 0);
let lastSync = LS.get('lastSync', null);
let scriptVersion = null;   // bis 2.2: Version des Google-Skripts, ab 3.0 ohne Bedeutung
let draft = LS.get('draft', null);   // laufendes Training (wird unten beim Start bereinigt)
let seenIds = new Set(events.map(e => e.id));

function saveLog() { LS.set('events', events); LS.set('pending', pending); LS.set('lastSeq', lastSeq); }
function saveDraft() { if (draft && draft.edit) { LS.set('edraft', draft); return; } LS.set('draft', draft); }
function addEvent(type, data, summary, opts = {}) {
  const e = { id: uid(), ts: new Date().toISOString(), person: cfg.me, type, data, summary, ...(opts.private ? { private: true } : {}) };
  pending.push(e); saveLog(); invalidate();
  sync({ quiet: true });
  return e;
}

/* ---------- Daten aus der Tabelle immer bereinigen ---------- */
const safeUrl = v => (/^https?:\/\//i.test(String(v || '').trim()) ? String(v).trim() : '');
const str = (v, n = 500) => String(v ?? '').slice(0, n);
function cleanEx(x) {
  x = x || {};
  const type = TYPE_LABEL[x.type] ? x.type : 'kg';
  const min = int(x.min) || 1;
  const id = str(x.id, 64) || 'x-' + uid().slice(0, 8);
  const o = {
    id, name: str(x.name, 80) || 'Übung', type, sets: Math.min(10, int(x.sets) || 3), min, max: Math.max(min, int(x.max) || min),
    step: isTimed(type) ? 0 : Math.max(0, num(x.step)), cue: str(x.cue), video: safeUrl(x.video), image: safeUrl(x.image),
    warmup: type === 'kg' && (x.warmup === undefined ? WARMUP_DEFAULT.has(id) : !!x.warmup), personal: !!x.personal
  };
  o.muscles = cleanMuscles(x.muscles) || libMuscles(id, o.name);
  if (x.replaces) o.replaces = str(x.replaces, 64);
  return o;
}
function cleanPlan(p, day) {
  return { title: str(p && p.title, 40) || (DEFAULT_PLAN[day] ? DEFAULT_PLAN[day].title : 'Tag ' + (DAYS.indexOf(day) + 1)), short: str(p && p.short, 6).trim() || DAY_SHORT[day],
    exercises: (Array.isArray(p && p.exercises) ? p.exercises : []).slice(0, 25).map(cleanEx) };
}
function cleanEntry(en) {
  en = en || {};
  const type = TYPE_LABEL[en.type] ? en.type : 'kg';
  const o = {
    exId: str(en.exId, 64), name: str(en.name, 80), type, note: str(en.note, 1000), feel: FEEL[en.feel] ? en.feel : '',
    sets: (Array.isArray(en.sets) ? en.sets : []).slice(0, 20).map(s => {
      const o2 = type === 'time' ? { r: int(s && s.r) } : type === 'tr' ? { t: int(s && s.t), r: int(s && s.r) } : { w: num(s && s.w), r: int(s && s.r) };
      if (s && SET_FEEL[s.f]) o2.f = s.f;
      if (s && ADD_WHY[s.a]) o2.a = s.a;
      return o2;
    })
  };
  if (Array.isArray(en.rm) && en.rm.length) o.rm = en.rm.slice(0, 10).map(r => (REM_WHY[r] ? r : ''));
  if (type === 'tr' && int(en.tt)) o.tt = int(en.tt);
  if (en.from && typeof en.from === 'object' && en.from.id) o.from = { id: str(en.from.id, 64), name: str(en.from.name, 80) };
  return o;
}
// Bewertung eines Satzes; alte Einträge hatten nur eine Bewertung pro Übung
function setFeel(h, j) {
  const s = h.sets[j];
  if (s && s.f) return s.f;
  if (h.feel === 'leicht') return 'locker';
  if (h.feel === 'schwer' && j === h.sets.length - 1) return 'limit';
  return '';
}
const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

/* ---------- Zustand aus dem Log berechnen ---------- */
let _st = null;
function invalidate() { _st = null; }
function st() { return _st || (_st = buildState()); }

function buildState() {
  const all = events.slice().sort((a, b) => a.seq - b.seq)
    .concat(pending.filter(p => !seenIds.has(p.id)).sort((a, b) => a.ts.localeCompare(b.ts)));
  const s = { spotSeen: {}, spotMyReact: {}, spotReacts: {}, pauses: {}, plans: {}, mine: {}, last: {}, lastBy: {}, workouts: [], skips: [], swaps: [], feed: [], changes: {}, lastChange: {}, lastShared: {}, decisions: {}, lastAction: {}, hist: {}, wedits: [], exInfo: {}, bw: {}, avatars: {}, first: {}, lib: null, libWarn: [], libHist: {} };
  _st = s; // für dl() während des Aufbaus
  // Nachträgliche Änderungen an abgeschlossenen Trainings: es gilt die jeweils letzte, nur von derselben Person
  const edits = {}, libEv = [], planHints = {};
  all.forEach(e => { if (e.type === 'workout_edit' && e.data && typeof e.data.ref === 'string') edits[e.data.ref] = e; });
  // „undefined“: Platzhalter, solange es noch keinen Buddy gibt (partner() liefert dann nichts)
  [...PEOPLE, 'undefined'].forEach(p => { s.plans[p] = clone(DEFAULT_PLAN); s.hist[p] = {}; s.last[p] = null; s.bw[p] = []; });
  PD(DEFAULT_PLAN).forEach(d => DEFAULT_PLAN[d].exercises.forEach(x => { s.exInfo[x.id] = { name: x.name, type: x.type }; }));
  all.forEach((e, k) => {
    if (!PEOPLE.includes(e.person) || !e.id || !e.ts) return;
    const ed = e.type === 'workout' ? edits[e.id] : null;
    if (ed && (ed.person === e.person || (ed.data && ed.data.as === e.person))) {
      if (ed.data.deleted) return;
      e = { ...e, data: { ...(e.data || {}), entries: ed.data.entries, edited: ed.ts, editedBy: ed.person } };
    }
    const d = e.data || {}; e.k = k;
    if (!s.first[e.person]) s.first[e.person] = e.ts;
    if (e.type === 'workout') {
      if (!DAYS.includes(d.day)) return;
      d.title = str(d.title, 40); d.entries = (Array.isArray(d.entries) ? d.entries : []).map(cleanEntry);
      d.deload = !!d.deload; d.deloadSkipped = !!d.deloadSkipped;
      if (isNaN(new Date(d.start))) d.start = e.ts;
      if (isNaN(new Date(d.end))) d.end = e.ts;
      d.plan = d.plan === 'mine' ? 'mine' : 'crew';
      { // Abgebrochen: weniger Sätze als geplant. Neue Trainings speichern die geplante Zahl, alte rechnen mit dem Plan dieses Tages.
        const pl = (d.plan === 'mine' && s.mine[e.person] ? s.mine[e.person] : s.plans[e.person])[d.day];
        const planned = int(d.plan) || (pl ? pl.exercises.reduce((a, x) => a + (d.deload ? Math.ceil((+x.sets || 1) / 2) : (+x.sets || 0)), 0) : 0);
        const doneN = d.entries.reduce((a, en) => a + en.sets.filter(st_ => int(st_.r) > 0).length, 0);
        e.abort = planned > 0 && doneN < planned ? { done: doneN, plan: planned } : null;
      }
      s.workouts.push(e); s.last[e.person] = s.lastBy[e.person + '|' + d.plan] = { day: d.day, plan: d.plan, ts: e.ts, kind: 'workout' };
      d.entries.forEach(en => {
        (s.hist[e.person][en.exId] = s.hist[e.person][en.exId] || []).push({ ts: e.ts, wid: e.id, sets: en.sets, rm: en.rm || [], tt: en.tt || 0, note: en.note, feel: en.feel, type: en.type, name: en.name, day: d.day, person: e.person, deload: d.deload, load: en.load });
        s.exInfo[en.exId] = { name: en.name, type: en.type };
      });
      s.feed.push(e);
    } else if (e.type === 'workout_edit') {
      // Training des anderen angepasst (Entwickleroptionen): erscheint in den Neuigkeiten und beim anderen in der Glocke
      if (typeof d.ref === 'string' && !d.deleted && PEOPLE.includes(d.as) && d.as !== e.person) {
        d.chg = (Array.isArray(d.chg) ? d.chg : []).slice(0, 12).map(c => str(c, 120)).filter(Boolean);
        s.wedits.push(e); s.feed.push(e);
      }
    } else if (e.type === 'skip') {
      if (!DAYS.includes(d.day)) return;
      d.plan = d.plan === 'mine' ? 'mine' : 'crew';
      s.last[e.person] = s.lastBy[e.person + '|' + d.plan] = { day: d.day, plan: d.plan, ts: e.ts, kind: 'skip' }; s.skips.push(e);
    } else if (e.type === 'pause') {
      const re = /^\d{4}-\d\d-\d\d$/;
      if (typeof d.pid !== 'string' || !re.test(d.from || '') || !re.test(d.to || '')) return;
      if (e.person === cfg.me && d.mirror) return;   // eigene öffentliche Kopie: das private Original gilt
      const m = s.pauses[e.person] = s.pauses[e.person] || {};
      m[d.pid] = d.deleted ? null : { pid: d.pid, from: d.from <= d.to ? d.from : d.to, to: d.to >= d.from ? d.to : d.from, reason: PZ_REASON[d.reason] ? d.reason : '', ts: e.ts };
    } else if (e.type === 'plan_change') {
      if (!DAYS.includes(d.day)) return;
      // Pläne vor 2.0 trugen Muskeln, Ausführung und Video selbst: einmalig als Stand für die Bibliothek übernehmen
      if (!d.v2) (Array.isArray(d.exercises) ? d.exercises : []).forEach(rx => {
        if (!rx || typeof rx.id !== 'string' || !rx.id) return;
        const seed = LIB_SEED[rx.id], h = planHints[rx.id] = planHints[rx.id] || { id: rx.id };
        h.name = str(rx.name, 80).trim() || h.name; if (TYPE_LABEL[rx.type]) h.type = rx.type; h.ts = e.ts; h.by = e.person;
        const m = cleanMuscles(rx.muscles);
        if (m && (m.p.length || m.s.length) && (!seed || JSON.stringify(m) !== JSON.stringify({ p: seed.p, s: seed.s }))) { h.p = m.p; h.s = m.s; }
        if (rx.cue && (!seed || rx.cue !== seed.cue)) h.cue = str(rx.cue, 1500);
        if (safeUrl(rx.video)) h.video = safeUrl(rx.video);
        if (int(rx.sets) && int(rx.min) && !seed) { h.sets = int(rx.sets); h.min = int(rx.min); h.max = int(rx.max); }
      });
      if (d.plan === 'mine') {
        // Mein Plan startet als Kopie des Crew-Plans zum Zeitpunkt der ersten eigenen Änderung
        const mp = s.mine[e.person] = s.mine[e.person] || clone(s.plans[e.person]);
        if (d.deleted) { if (PD(mp).length > 1) delete mp[d.day]; }
        else { const p = cleanPlan(d, d.day); mp[d.day] = p; p.exercises.forEach(x => { s.exInfo[x.id] = s.exInfo[x.id] || { name: x.name, type: x.type }; }); }
        return;
      }
      if (d.deleted) {
        if (!s.plans[e.person][d.day] || PD(s.plans[e.person]).length < 2) return;
        delete s.plans[e.person][d.day];
        s.changes[e.id] = e; s.lastShared[e.person + '|' + d.day] = e; s.lastChange[e.person + '|' + d.day] = e; s.lastAction[e.person + '|' + d.day] = k;
        return;
      }
      const p = cleanPlan(d, d.day); d.title = p.title; d.short = p.short; d.exercises = p.exercises;
      if (sharedDiff(s.plans[e.person][d.day] || EMPTY_DAY, p).length) s.lastShared[e.person + '|' + d.day] = e;
      s.plans[e.person][d.day] = clone(p);
      p.exercises.forEach(x => { s.exInfo[x.id] = s.exInfo[x.id] || { name: x.name, type: x.type }; s.exInfo[x.id].name = x.name; });
      s.changes[e.id] = e; s.lastChange[e.person + '|' + d.day] = e; s.lastAction[e.person + '|' + d.day] = k;
    } else if (e.type === 'plan_decision') {
      const ch = s.changes[d.changeId];
      const decision = d.decision === 'accepted' ? 'accepted' : 'dismissed';
      s.decisions[e.person + '|' + d.changeId] = { decision, k, ts: e.ts };
      if (ch && decision === 'accepted') {
        if ((d.result && d.result.deleted) || (!d.result && ch.data.deleted)) { if (PD(s.plans[e.person]).length > 1) delete s.plans[e.person][ch.data.day]; }
        else s.plans[e.person][ch.data.day] = d.result && Array.isArray(d.result.exercises) ? cleanPlan(d.result, ch.data.day) : cleanPlan(ch.data, ch.data.day);
        s.lastAction[e.person + '|' + ch.data.day] = k;
      }
    } else if (e.type === 'swap') {
      if (!DAYS.includes(d.day) || !d.to) return;
      d.to = cleanEx(d.to); d.fromId = str(d.fromId, 64); d.fromName = str(d.fromName, 80); d.date = str(d.date, 10);
      s.exInfo[d.to.id] = s.exInfo[d.to.id] || { name: d.to.name, type: d.to.type };
      s.swaps.push(e); s.feed.push(e);
    } else if (e.type === 'bodyweight') {
      const kg = num(d.kg);
      if (kg >= 30 && kg <= 300) {
        const from = /^\d{4}-\d{2}-\d{2}$/.test(d.from || '') ? d.from : dateKey(e.ts);
        const list = s.bw[e.person], i = list.findIndex(b => b.from === from);
        if (i >= 0) list.splice(i, 1);   // gleicher Tag: der neuere Eintrag gilt
        list.push({ ts: e.ts, kg, from });
        list.sort((a, b) => a.from.localeCompare(b.from));
      }
    } else if (e.type === 'lib') {
      if (typeof d.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(d.id)) { libEv.push(e); (s.libHist[d.id] = s.libHist[d.id] || []).push(e); }
    } else if (e.type === 'spot_seen') {
      if (typeof d.spot === 'string') (s.spotSeen[d.spot] = s.spotSeen[d.spot] || new Set()).add(e.person);
    } else if (e.type === 'spot_react') {
      // eine Reaktion pro Person und Spot, die letzte zählt; leeres Emoji nimmt sie zurück
      if (typeof d.spot === 'string' && (d.emoji === '' || isEmoji(d.emoji))) {
        const r = s.spotReacts[d.spot] = s.spotReacts[d.spot] || {}, prev = r[e.person];
        if (prev && prev.ev) { const k = s.feed.indexOf(prev.ev); if (k >= 0) s.feed.splice(k, 1); }
        if (d.emoji) r[e.person] = { emoji: d.emoji, ts: e.ts, ev: d.owner === cfg.me && e.person !== cfg.me ? e : null }; else delete r[e.person];
        if (e.person === cfg.me) { if (d.emoji) s.spotMyReact[d.spot] = d.emoji; else delete s.spotMyReact[d.spot]; }
        if (d.emoji && d.owner === cfg.me && e.person !== cfg.me) s.feed.push(e);
      }
    } else if (e.type === 'avatar') {
      if (d.img === '') delete s.avatars[e.person];
      else if (typeof d.img === 'string' && d.img.length < 60000 && AVATAR_RE.test(d.img)) s.avatars[e.person] = d.img;
    }
  });
  s.feed.reverse();
  buildLib(s, libEv, planHints);
  return s;
}
// Bibliothek zusammensetzen und auf Pläne, Verlauf und Trainings anwenden (Namen, Muskeln, Ausführung, Zusammenführen)
function buildLib(s, libEv, planHints) {
  const lib = {}, warn = [];
  Object.values(LIB_SEED).forEach(L => { lib[L.id] = { ...L, p: L.p.slice(), s: L.s.slice() }; });
  const recs = [];
  Object.entries(s.exInfo).forEach(([id, v]) => { if (!lib[id] && !planHints[id]) { const m = libMuscles(id, v.name); recs.push({ id, name: v.name, type: v.type, p: m.p, s: m.s, ts: '0' }); } });
  Object.values(planHints).forEach(h => recs.push({ ...h, ts: h.ts || '0' }));
  (Array.isArray(libSheet) ? libSheet : []).forEach(r => { const x = libFromRow(r, warn); if (x) recs.push(x); });
  libEv.forEach(e => recs.push({ ...e.data, ts: e.ts, by: e.person }));
  recs.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  recs.forEach(r => {
    const base = lib[r.id];
    if (base && r.ts && base.ts && base.ts > r.ts) return;
    const L = cleanLib(r, base);
    if (!L.ts && base) L.ts = base.ts;
    if (r.into && !lib[r.into] && !recs.some(x => x.id === r.into)) { L.into = ''; }
    lib[r.id] = L;
  });
  // Name im Feld „Zusammengeführt in“ aus dem Blatt → Kennung
  Object.values(lib).forEach(L => { if (L.into && !lib[L.into]) { const t = Object.values(lib).find(y => normName(y.name) === normName(L.into)); L.into = t && t.id !== L.id ? t.id : ''; } if (L.into === L.id) L.into = ''; });
  s.lib = lib; s.libWarn = warn;
  const T = id => libTarget(lib, id);
  PEOPLE.forEach(p => Object.keys(s.hist[p]).forEach(id => {
    const t = T(id); if (t === id) return;
    s.hist[p][t] = (s.hist[p][t] || []).concat(s.hist[p][id]).sort((a, b) => a.ts.localeCompare(b.ts)); delete s.hist[p][id];
  }));
  PEOPLE.flatMap(p => [s.plans[p], s.mine[p]]).filter(Boolean).forEach(plan => PD(plan).forEach(d => {
    const pl = plan[d], seen = new Set();
    pl.exercises = pl.exercises.filter(x => {
      x.id = T(x.id); if (seen.has(x.id)) return false; seen.add(x.id);
      const L = lib[x.id];
      if (L && !L.del) { x.name = L.name; x.type = L.type; x.muscles = { p: L.p.slice(), s: L.s.slice() }; x.cue = L.cue; x.video = L.video; if (isTimed(x.type)) x.step = 0; if (x.type !== 'kg') x.warmup = false; }
      return true;
    });
  }));
  // Trainings nur als Kopie anpassen: die Einträge im Log bleiben unverändert (Zusammenführen lässt sich trennen)
  const swapW = new Map();
  s.workouts = s.workouts.map(w => {
    const ents = w.data.entries.map(en => { const t = T(en.exId), L = lib[t]; return t !== en.exId || (L && L.name !== en.name) ? { ...en, exId: t, name: L ? L.name : en.name } : en; });
    if (ents.every((en, i) => en === w.data.entries[i])) return w;
    const nw = { ...w, data: { ...w.data, entries: ents } }; swapW.set(w, nw); return nw;
  });
  if (swapW.size) s.feed = s.feed.map(e => swapW.get(e) || e);
  PEOPLE.forEach(p => Object.entries(s.hist[p]).forEach(([id, list]) => { const L = lib[id]; if (L) list.forEach(h => { h.name = L.name; }); }));
  Object.keys(s.exInfo).forEach(id => { const L = lib[T(id)]; if (L) s.exInfo[id] = { name: L.name, type: L.type }; });
  Object.values(lib).forEach(L => { if (!s.exInfo[L.id]) s.exInfo[L.id] = { name: L.name, type: L.type }; });
}

// Plan eines Menschen: Crew-Plan oder Mein Plan (ohne eigene Änderung = der Crew-Plan)
const planOf = (p, k = 'crew') => (k === 'mine' ? st().mine[p] || st().plans[p] : st().plans[p]) || {};
const pdays = (p, k = 'crew') => PD(planOf(p, k));
const hasCrew = () => !!(CREW && CREW.id);
// aktueller Plan: der, aus dem zuletzt trainiert wurde; ohne Crew immer Mein Plan
function curPlan(p = cfg.me) { if (p === cfg.me && !hasCrew()) return 'mine'; const l = st().last[p]; return l && l.plan === 'mine' ? 'mine' : 'crew'; }
function nextDay(p, k = curPlan(p)) {
  const days = pdays(p, k), l = st().lastBy[p + '|' + k];
  if (!days.length) return 'A';
  if (!l) return days[0];
  const i = DAYS.indexOf(l.day);
  return days.find(d => DAYS.indexOf(d) > i) || days[0];
}
function isPending(id) { return !seenIds.has(id) && pending.some(p => p.id === id); }
// Körpergewicht nach Zeitraum: jeder Eintrag gilt ab seinem Datum bis zum nächsten, davor gilt der erste
function bwAt(p, when) {
  const list = st().bw[p] || [];
  if (!list.length) return null;
  const k = dateKey(when);
  let cur = list[0];
  for (const b of list) { if (b.from <= k) cur = b; else break; }
  return cur.kg;
}

/* ---------- Kennzahlen ---------- */
function workW(sets) { const v = sets.filter(s => int(s.r) > 0).map(s => num(s.w)); return v.length ? Math.max(...v) : 0; }
function score(type, sets) {
  if (type === 'time') return Math.max(0, ...sets.map(s => int(s.r)));
  if (type === 'tr') { const t = Math.max(0, ...sets.filter(s => int(s.r) > 0).map(s => int(s.t))); return t * 1000 + Math.max(0, ...sets.filter(s => int(s.t) === t).map(s => int(s.r))); }
  const w = workW(sets);
  return w * 1000 + sum(sets.filter(s => num(s.w) === w).map(s => int(s.r)));
}
const usesWeight = (type, sets) => type === 'kg' || (type === 'bw' && sets.some(s => num(s.w) !== 0));
function metricLabel(type, sets) {
  if (!sets || !sets.length) return '–';
  if (type === 'kg') return fmtN(workW(sets)) + ' kg';
  if (type === 'time') return Math.max(...sets.map(s => int(s.r))) + ' s';
  if (type === 'tr') { const v = score(type, sets); return `${v % 1000} Wdh. in ${Math.floor(v / 1000)} s`; }
  const reps = sum(sets.map(s => int(s.r))); const w = workW(sets);
  return reps + ' Wdh.' + (w ? ' · ' + fmtSigned(w) : '');
}
function fmtSets(type, sets) {
  if (!sets || !sets.length) return '–';
  if (type === 'kg') return sets.map(s => `${fmtN(num(s.w))}×${int(s.r)}`).join(' · ');
  if (type === 'time') return sets.map(s => int(s.r)).join(' · ') + ' s';
  if (type === 'tr') return sets.map(s => `${int(s.t)} s × ${int(s.r)}`).join(' · ');
  if (sets.some(s => num(s.w) !== 0)) return sets.map(s => `${int(s.r)}${num(s.w) ? ` × ${fmtSigned(num(s.w))}` : ''}`).join(' · ');
  return sets.map(s => int(s.r)).join(' · ') + ' Wdh.';
}
// Bewertungen pro Satz als Text („Passt · Am Limit · –“); alte Einträge haben eine Bewertung pro Übung
function feelText(en) {
  if (en.sets && en.sets.some(s => s.f)) return en.sets.map(s => SET_FEEL[s.f] || '–').join(' · ');
  return en.feel ? FEEL[en.feel] : '';
}
const normalSessions =(p, id, type) => (st().hist[p][id] || []).filter(h => !h.deload && (!type || h.type === type));
const lastAny = (p, id) => { const h = st().hist[p][id]; return h && h.length ? h[h.length - 1] : null; };

function improvements(e) {
  if (e.data.deload) return [];
  const out = [];
  (e.data.entries || []).forEach(en => {
    const h = normalSessions(e.person, en.exId, en.type);
    const i = h.findIndex(x => x.wid === e.id);
    if (i <= 0 || !en.sets.length) return;
    const prev = h.slice(0, i), last = prev[prev.length - 1];
    const cur = score(en.type, en.sets), best = Math.max(...prev.map(x => score(x.type, x.sets)));
    if (cur <= score(last.type, last.sets)) return;
    let label;
    if (en.type === 'time') label = `+${Math.max(...en.sets.map(s => s.r)) - Math.max(...last.sets.map(s => s.r))} s`;
    else if (en.type === 'tr') { const a = score('tr', en.sets), b = score('tr', last.sets), dt = Math.floor(a / 1000) - Math.floor(b / 1000); label = dt > 0 ? `+${dt} s` : `+${a % 1000 - b % 1000} Wdh.`; }
    else {
      const dW = Math.round((workW(en.sets) - workW(last.sets)) * 100) / 100;
      if (dW > 0) label = `+${fmtN(dW)} kg`;
      else { const dr = sum(en.sets.map(s => s.r)) - sum(last.sets.map(s => s.r)); label = dr > 0 ? `+${dr} Wdh.` : 'mehr geschafft'; }
    }
    out.push({ name: en.name, exId: en.exId, label, pr: cur > best });
  });
  return out;
}

/* ---------- Steigerung pro Satz ----------
   Grundlage ist das letzte normale Training (ohne Deload). Jeder Satz wird einzeln bewertet:
   Der schwächste Arbeitssatz entscheidet über die Steigerung, ein eingebrochener letzter Satz bekommt ein Back-off.
   Die Steigerung richtet sich nach ca. 2,5 % der Last, gerundet auf die Stufe aus dem Plan (mindestens eine Stufe). */
const kgLabel = d => `${d > 0 ? '+' : '−'}${fmtN(Math.abs(d))} KG`;
function setRange(list) {
  const n = list.map(j => j + 1);
  if (n.length === 1) return String(n[0]);
  const cont = n.every((v, i) => i === 0 || v === n[i - 1] + 1);
  return cont ? `${n[0]}–${n[n.length - 1]}` : n.slice(0, -1).join(', ') + ' und ' + n[n.length - 1];
}
// Geschätzte Maximalkraft einer Einheit (Epley mit geschätzten Wiederholungen im Tank)
// Körpergewichtsübungen: mit einem festen Bezugsgewicht (nicht angezeigt), damit Zu- oder Abnehmen nichts verfälscht
const bwRef = (p, when) => bwAt(p, when || new Date()) ?? 80;
function sessionStrength(h, x, p, ref) {
  const idx = h.sets.map((s, j) => j).filter(j => int(h.sets[j].r) > 0);
  if (!idx.length) return 0;
  if (h.type === 'time') return Math.max(...idx.map(j => int(h.sets[j].r)));
  if (h.type === 'tr') return Math.max(...idx.map(j => int(h.sets[j].t) ? int(h.sets[j].r) / int(h.sets[j].t) * 60 : 0));
  const body = h.type === 'bw' ? (ref ?? bwRef(p || h.person)) : 0;
  return Math.max(...idx.map(j => {
    const s = h.sets[j], load = h.type === 'bw' ? body + num(s.w) : num(s.w);
    return load * (1 + (int(s.r) + (RIR[setFeel(h, j)] ?? RIR.passt)) / 30);
  }));
}
function isPlateau(h, x, p) {
  if (h.length < 4) return false;
  const v = h.map(s => sessionStrength(s, x, p));
  const before = Math.max(...v.slice(0, -3));
  return before > 0 && v.slice(-3).every(y => y <= before * 1.005);
}
// Vorschlag für das nächste Training: Hinweistext und Gewicht pro Satz (mit Markierung und Label am Gewichtsfeld)
// Bewertungsgrundlage einer Einheit: Bonus-Sätze zählen nicht, ein wiederholter Satz ersetzt den davor
function evalSess(sess) {
  const sets = sess.sets.filter((st_, j) => st_.a !== 'b' && !(sess.sets[j + 1] && sess.sets[j + 1].a === 'r'));
  return { ...sess, sets };
}
const rmOf = (sess, ...keys) => (sess.rm || []).filter(r => keys.includes(r)).length;
/* Zeit + Wdh.: erst die Zeit in der Spanne steigern (+5 s, alle locker +10 s), oben angekommen mehr Wiederholungen.
   Halten bei Stopp vor Ablauf, „Am Limit“, Erschöpfung oder Schmerzen; zweimal nicht geschafft: −5 s. */
function planTr(x, h, n) {
  const mk = (t, kind, hint, lab = '', m = '') => ({ kind, hint, base: t, tt: t, sets: Array.from({ length: n }, () => ({ w: t, mk: m, lab })) });
  if (!h.length) return mk(x.min, 'new', `Erstes Mal: ${x.min} s pro Satz, so viele saubere Wiederholungen wie möglich.`);
  const evalOf = sess => sess.sets.filter(st_ => int(st_.r) > 0);
  const tOf = sess => int(sess.tt) || Math.max(0, ...evalOf(sess).map(st_ => int(st_.t)));
  const okOf = sess => { const ss = evalOf(sess), t = tOf(sess); return ss.length > 0 && ss.every(st_ => int(st_.t) >= t); };
  const last = h[h.length - 1], ls = evalOf(last);
  if (!ls.length) return mk(x.min, 'new', `Ziel: ${x.min} s pro Satz.`);
  const T = Math.min(Math.max(tOf(last), x.min), x.max);
  const complete = ls.length >= x.sets - rmOf(last, 'zeit', 'geraet');
  const feels = ls.map((st_, j) => setFeel({ ...last, sets: ls }, j));
  const limit = feels.includes('limit') || rmOf(last, 'erschoepft') > 0;
  const allLocker = feels.every(f => f === 'locker');
  const minR = Math.min(...ls.map(st_ => int(st_.r)));
  const prev = h.length > 1 ? h[h.length - 2] : null, ps = prev ? evalOf(prev) : [];
  const dropped = !!prev && tOf(prev) === tOf(last) && ps.length > 0 && minR < Math.min(...ps.map(st_ => int(st_.r))) * 0.8;
  const failNow = !okOf(last) || dropped, failPrev = !!prev && !okOf(prev);
  const days = (Date.now() - new Date(last.ts)) / 864e5;
  const down = t => mk(t, 'down', '', `↓ −${T - t} S`, 'down');
  if (rmOf(last, 'schmerz')) return mk(T, 'hold', `Letztes Mal Schmerzen angegeben. Heute wieder ${T} s, vorsichtig starten und im Zweifel früher stoppen.`);
  if (days >= PAUSE_DAYS && T > x.min) { const r = down(Math.max(x.min, T - 5)); r.hint = `Länger nicht trainiert. Heute ${r.base} s zum Wiedereinstieg.`; return r; }
  if (failNow && failPrev && T > x.min) { const r = down(Math.max(x.min, T - 5)); r.hint = `Zweimal nicht ganz geschafft. Heute ${r.base} s und neu aufbauen.`; return r; }
  if (failNow) return mk(T, 'hold', dropped ? `Die Wiederholungen sind letztes Mal eingebrochen. Heute wieder ${T} s.` : `Letztes Mal nicht ganz durchgehalten. Heute wieder ${T} s.`);
  if (limit) return mk(T, 'hold', `Volle Zeit geschafft, aber am Limit. Heute wieder ${T} s, Ziel: mehr als ${minR} Wdh. im schwächsten Satz.`);
  if (!complete) return mk(T, 'hold', `Nicht alle Sätze gemacht. Heute wieder ${T} s.`);
  if (T < x.max) {
    const t = Math.min(x.max, T + (allLocker ? 10 : 5));
    return mk(t, 'up', allLocker ? `Alle Sätze locker durchgezogen. Heute ${t} s.` : `Alle Sätze voll durchgezogen. Heute ${t} s.`, `↑ +${t - T} S`, 'up');
  }
  const top = h.slice(-3).filter(sess => tOf(sess) >= x.max);
  const stuck = top.length === 3 && evalOf(top[2]).length && Math.min(...evalOf(top[2]).map(st_ => int(st_.r))) <= Math.min(...evalOf(top[0]).map(st_ => int(st_.r)));
  if (stuck && allLocker) return mk(T, 'hold', `Bei ${x.max} s und alle Sätze locker. Zeit für eine längere Spanne im Plan oder eine schwerere Variante.`);
  return mk(T, 'hold', `Bei ${x.max} s angekommen. Ziel: ${minR + 1} Wdh. im schwächsten Satz.`);
}
/* ---------- Fortschritt 3.2 ----------
   Stufen: Langhantel und Körpergewicht immer + Stufe aus dem Plan. Maschinen und Kurzhanteln: nächstes bereits eingetragenes
   Gewicht (höchstens zwei Stufen entfernt), sonst bleibt das Feld leer mit „↑ letztes Gewicht“ und wird beim Eintragen gelernt.
   Neue Stufe: Satz an der Obergrenze und „locker“ oder zweimal „passt“ (ohne Bewertung = passt). „Limit“ hält.
   Ausgleich: leichtere Sätze holen auf, die schwersten halten (Toleranz eine Stufe); nach 3 Trainings ohne Ausgleich steigt jeder Satz für sich.
   Wiederholungen: Summe der Sätze mit gleichem Gewicht + 1, gleichmäßig verteilt, als Mindestziel. */
const isBarbell = x => x.type === 'kg' && /langhantel|sz-stange|sz stange/i.test(x.name || '');
function knownWeights(p, x) { return [...new Set(normalSessions(p, x.id, x.type).flatMap(s => s.sets.filter(z => int(z.r) > 0).map(z => num(z.w))))].sort((a, b) => a - b); }
// Gelernte Stufe: kleinster Abstand zwischen zwei eingetragenen Gewichten (nur Maschinen und Kurzhanteln)
function learnedStep(p, x) {
  if (x.type !== 'kg' || isBarbell(x)) return 0;
  const K = knownWeights(p, x); let m = 0;
  for (let i = 1; i < K.length; i++) { const d = Math.round((K[i] - K[i - 1]) * 100) / 100; if (d >= 0.5 && (!m || d < m)) m = d; }
  return m;
}
function progress32(x, h, n, p) {
  const bw = x.type === 'bw', hasStep = x.step > 0;
  const hs = h.filter(s => s.sets.some(z => int(z.r) > 0));
  if (!hs.length) return null;
  const L = hs[hs.length - 1], P = hs.length > 1 ? hs[hs.length - 2] : null;
  const ls = L.sets.filter(z => int(z.r) > 0), ps = P ? P.sets.filter(z => int(z.r) > 0) : [];
  const plan = isBarbell(x) ? Math.max(2.5, stepOf(x)) : stepOf(x), ls_ = learnedStep(p, x), step = Math.max(plan, ls_ || 0);
  const exact = bw || isBarbell(x), K = knownWeights(p, x), canStep = !bw || hasStep;
  const r2 = v => Math.round(v * 100) / 100;
  // Kurzhanteln gibt es in festen Abständen: ohne bekanntes Gewicht einfach + Stufe. Nur an Maschinen fragt die App nach der Platte.
  const dumbbell = /kurzhantel/i.test(x.name || '');
  const next = w => { if (exact) return { w: r2(w + plan) }; const c = K.find(k => k > w + step * 0.25 + 1e-9 && k <= w + step * 2 + 1e-9); return c !== undefined ? { w: c } : dumbbell ? { w: r2(w + plan) } : { w: null, ph: w }; };
  const feel = (s, j) => setFeel(s, j) || 'passt';
  const set = (arr, j) => arr[j] || arr[arr.length - 1];
  const wOf = arr => Math.max(...arr.map(z => num(z.w)));
  const close = (w, M) => w >= M - 1e-9 || w >= M - step - 1e-9;
  const isEq = arr => { const M = wOf(arr); return arr.every(z => close(num(z.w), M)); };
  const W = wOf(ls), equal = isEq(ls);
  let uneq = 0; for (let i = hs.length - 1; i >= 0; i--) { const a = hs[i].sets.filter(z => int(z.r) > 0); if (isEq(a)) break; uneq++; }
  const individual = equal || uneq >= 3;
  const found = hs.some(s => s.sets.some((z, j) => int(z.r) > 0 && ['passt', 'limit'].includes(setFeel(s, j) || 'passt')));
  const res = [];
  for (let j = 0; j < n; j++) {
    const k = Math.min(j, ls.length - 1), s = set(ls, j), w = num(s.w), r = int(s.r), f = feel(L, k);
    const q = ps.length ? set(ps, j) : null, pf = q ? feel(P, Math.min(j, ps.length - 1)) : '';
    let go = canStep && r >= x.max && (f === 'locker' || (f === 'passt' && q && int(q.r) >= x.max && pf === 'passt' && num(q.w) === w));
    let held = false;
    if (go && !individual && w >= W - 1e-9) { go = false; held = true; }
    const nx = go ? next(w) : null;
    res.push({ j, w0: w, r, go, held, w: go ? nx.w : w, ph: go && nx.w == null ? nx.ph : null });
  }
  // Mindestziel: Sätze mit gleichem Gewicht zusammen, Summe + 1, gleichmäßig, Rest nach vorn
  const groups = {};
  res.forEach(z => { if (!z.go) (groups[z.w] = groups[z.w] || []).push(z); else z.t = x.min; });
  Object.values(groups).forEach(g => {
    const tot = g.reduce((a, z) => a + z.r, 0) + 1, base = Math.floor(tot / g.length), rest = tot % g.length;
    g.forEach((z, i) => { z.t = Math.min(x.max, Math.max(x.min, base + (i < rest ? 1 : 0))); });
  });
  const fmtW = v => !bw ? fmtN(v) + ' kg' : v === 0 ? 'Körpergewicht' : v > 0 ? `+${fmtN(v)} kg` : `${fmtN(-v)} kg Abzug`;
  const ups = res.filter(z => z.go && z.w != null).map(z => z.j), unk = res.filter(z => z.ph != null).map(z => z.j), helds = res.filter(z => z.held).map(z => z.j);
  const parts = [];
  if (ups.length) parts.push(`${!found ? 'Arbeitsgewicht finden: ' : ''}Satz ${setRange(ups)} ${ups.length === 1 ? 'war' : 'waren'} am oberen Ende${res.filter(z => ups.includes(z.j)).every(z => feel(L, Math.min(z.j, ls.length - 1)) === 'locker') ? ' und locker' : ''}, heute eine Stufe mehr.`);
  if (unk.length) parts.push(`Satz ${setRange(unk)}: eine Platte schwerer stecken und das Gewicht eintragen, die App merkt es sich.`);
  if (helds.length) parts.push(`Satz ${setRange(helds)} ${helds.length === 1 ? 'bleibt' : 'bleiben'} bei ${fmtW(W)}, bis die anderen aufgeholt haben.`);
  if (!equal && uneq === 3 && res.some(z => z.go)) parts.push(`Die Sätze sind seit 3 Trainings unterschiedlich schwer. Ab jetzt steigt jeder Satz für sich.`);
  let kind = res.some(z => z.go) ? 'up' : 'hold';
  if (!parts.length) {
    const top = res.filter(z => z.r >= x.max && !z.go);
    if (bw && !hasStep && res.every(z => z.r >= x.max)) parts.push(`Alle Sätze am oberen Ende. Zeit für Zusatzgewicht oder eine höhere Spanne im Plan.`);
    else if (isPlateau(h, x, p)) { kind = 'plateau'; parts.push('Seit 3 Trainings kein Fortschritt. Ziel: die Mindestzahl in jedem Satz.'); }
    else if (top.length && top.some(z => feel(L, Math.min(z.j, ls.length - 1)) === 'limit')) parts.push('Am oberen Ende, aber am Limit. Gewicht halten.');
    else if (top.length) parts.push(`Am oberen Ende geschafft. Noch einmal so, dann gibt es die nächste Stufe.`);
    else parts.push(`Gleiches Gewicht. Ziel: ${res.reduce((a, z) => a + z.t, 0)} Wiederholungen insgesamt, eine mehr als zuletzt.`);
  }
  const sets = res.map(z => {
    if (z.ph != null) return { w: null, ph: z.ph, t: z.t, mk: 'up' };
    const d = r2(z.w - z.w0);
    if (d > 0) return { w: z.w, t: z.t, mk: 'up', lab: bw && z.w === 0 && z.w0 < 0 ? '↑ OHNE ABZUG' : '↑ ' + kgLabel(d) };
    return { w: z.w, t: z.t };
  });
  return { kind, hint: parts.join(' '), base: W, sets };
}
function planFor(x, p = cfg.me) {
  const n = Math.max(1, +x.sets || 1);
  if (x.type === 'tr') return planTr(x, normalSessions(p, x.id, x.type).map(evalSess), n);
  const h = normalSessions(p, x.id, x.type).map(evalSess);
  const noBody = '';
  const blank = (hint, kind = 'new', base = null) => ({ kind, hint, base, sets: Array.from({ length: n }, () => ({ w: null })) });
  if (!h.length) {
    if (x.type === 'time') return blank(`Erstes Mal: Ziel ${x.min}–${x.max} Sekunden pro Satz.`);
    if (x.type === 'bw') return blank(`Erstes Mal: Ziel ${x.min}–${x.max} Wiederholungen pro Satz.` + noBody);
    return blank(`Erstes Mal: Wähle ein Gewicht für ${x.min}–${x.max} saubere Wiederholungen.`);
  }
  const last = h[h.length - 1], ls = last.sets.filter(s => int(s.r) > 0);
  if (!ls.length) return blank(noBody.trim());
  if (x.type === 'time') {
    const best = Math.max(...ls.map(s => int(s.r)));
    return blank(best >= x.max ? 'Oberes Ende erreicht. Zeit für eine schwerere Variante oder eine längere Spanne.' : `Ziel: länger als ${best} s.`, 'hold');
  }
  const bw = x.type === 'bw', step = stepOf(x), hasStep = x.step > 0;
  const fl = (sess, j) => setFeel({ ...sess, sets: sess.sets.filter(s => int(s.r) > 0) }, j);
  const lw = j => num((ls[j] || ls[ls.length - 1]).w);
  const reps = j => int(ls[j].r);
  const W = Math.max(...ls.map(s => num(s.w)));
  const main = ls.map((s, j) => j).filter(j => num(ls[j].w) === W);
  const back = ls.map((s, j) => j).filter(j => num(ls[j].w) < W);
  const full = ls.length >= x.sets - rmOf(last, 'zeit', 'geraet');
  const tired = rmOf(last, 'erschoepft') > 0, pain = rmOf(last, 'schmerz') > 0;
  const allTop = full && main.every(j => reps(j) >= x.max);
  const allTop2 = full && main.every(j => reps(j) >= x.max + 2);
  const allLocker = main.every(j => fl(last, j) === 'locker');
  const limits = main.filter(j => fl(last, j) === 'limit');
  const weakBelow = sess => { const ss = sess.sets.filter(s => int(s.r) > 0); if (!ss.length) return false; const M = Math.max(...ss.map(s => num(s.w))); return ss.some(s => num(s.w) === M && int(s.r) < x.min); };
  const below = weakBelow(last), prevBelow = h.length > 1 && weakBelow(h[h.length - 2]);
  const lastMain = main[main.length - 1];
  const collapse = main.length >= 2 && reps(lastMain) < x.min && main.slice(0, -1).every(j => reps(j) >= x.min);
  const days = (Date.now() - new Date(last.ts)) / 864e5;
  const fmtW = v => !bw ? fmtN(v) + ' kg' : v === 0 ? 'Körpergewicht' : v > 0 ? `+${fmtN(v)} kg` : `${fmtN(-v)} kg Abzug`;
  const down = v => (bw ? (hasStep ? roundTo(v - step, step) : v) : roundTo(v * 0.9, step));
  const total = bw ? 0 : W;
  const inc = hasStep ? Math.max(step, roundTo(Math.abs(total) * 0.025, step)) : 0;
  const tw = Array.from({ length: n }, (v, j) => lw(j));
  let kind = 'hold', hint = '', backoffSet = -1, tenPct = false;
  const lessMore = d => (W > 0 ? `${fmtN(d)} kg weniger Zusatz` : `${fmtN(d)} kg mehr Abzug`);
  if (pain) {
    hint = 'Letztes Mal Schmerzen angegeben. Gewicht halten, vorsichtig starten und im Zweifel leichter.';
  } else if (days >= PAUSE_DAYS && (!bw || hasStep)) {
    for (let j = 0; j < n; j++) tw[j] = down(tw[j]);
    kind = 'down'; tenPct = !bw;
    hint = bw ? `Länger nicht trainiert. Heute ${lessMore(step)} zum Wiedereinstieg.` : 'Länger nicht trainiert. Heute −10 % zum Wiedereinstieg.';
  } else if (below && prevBelow && (!bw || hasStep)) {
    for (let j = 0; j < n; j++) tw[j] = down(tw[j]);
    kind = 'down'; tenPct = !bw;
    hint = bw ? `Zweimal unter der Spanne. Heute ${lessMore(step)}.` : 'Zweimal unter der Spanne. Heute −10 % und neu aufbauen.';
  } else if (collapse && (!bw || hasStep)) {
    const others = main.slice(0, -1);
    for (let j = 0; j < n; j++) tw[j] = main.includes(j) || j >= ls.length ? W : lw(j);
    for (let j = lastMain; j < n; j++) if (j === lastMain || j >= ls.length) tw[j] = down(W);
    backoffSet = lastMain; kind = 'backoff';
    hint = `Satz ${lastMain + 1} ist letztes Mal eingebrochen. Satz ${setRange(others)} ${others.length === 1 ? 'bleibt' : 'bleiben'} bei ${fmtW(W)}, Satz ${lastMain + 1} heute ${fmtW(tw[lastMain])}.`;
  } else if (below) {
    hint = collapse ? `Satz ${lastMain + 1} ist letztes Mal eingebrochen. Weniger Wiederholungen im letzten Satz sind okay.` : 'Letztes Mal unter der Spanne. Gewicht halten.';
  } else {
    // 3.2: jeder Satz einzeln, höchstens eine Stufe, Ausgleich, Mindestziel für Wiederholungen
    const pr = progress32(x, h, n, p);
    if (pr) return pr;
  }
  const sets = tw.map((w, j) => {
    const d = Math.round((w - lw(j)) * 100) / 100;
    if (j === backoffSet || (kind === 'backoff' && j > backoffSet && j >= ls.length)) return { w, mk: 'down', lab: '↓ BACK-OFF' };
    if (kind === 'down' && tenPct) return { w, mk: 'down', lab: '↓ −10 %' };
    if (d > 0) return { w, mk: 'up', lab: bw && w === 0 && lw(j) < 0 ? '↑ OHNE ABZUG' : '↑ ' + kgLabel(d) };
    if (d < 0) return { w, mk: 'down', lab: '↓ ' + kgLabel(d) };
    return { w };
  });
  return { kind, hint: (hint + noBody).trim(), base: W, sets };
}
// Zuletzt benutzte Werte für Zusatz und Abzug (für den Umschalter +/−)
function lastSides(p, x, j) {
  const h = normalSessions(p, x.id, 'bw');
  let plus = null, minus = null;
  for (let i = h.length - 1; i >= 0 && (plus == null || minus == null); i--) {
    const ss = h[i].sets.filter(s => int(s.r) > 0), s = ss[j] || ss[ss.length - 1];
    const cand = s ? [s, ...ss] : ss;
    cand.forEach(c => { const w = num(c.w); if (w > 0 && plus == null) plus = w; if (w < 0 && minus == null) minus = -w; });
  }
  return { plus, minus };
}
function plateauCount(p) {
  return pdays(p, curPlan(p)).reduce((a, d) => a + planOf(p, curPlan(p))[d].exercises.filter(x => !isTimed(x.type) && isPlateau(normalSessions(p, x.id, x.type), x, p)).length, 0);
}

/* ---------- Deload (für jede Person getrennt) ---------- */
function deloadState(p) {
  const ws = st().workouts.filter(w => w.person === p);
  // Wiedereinstieg: nach einer Pause über 7 Tage laufen die nächsten 3 Trainings als Deload
  if (p === cfg.me) {
    const t = todayStr(), lp = pausesOf(p).filter(x => x.from <= t && dayNum(x.to) - dayNum(x.from) + 1 > 7).pop();
    if (lp && !pauseOn(p, t)) {
      const after = ws.filter(w => dateKey(w.ts) >= lp.from), days = dayNum(lp.to) - dayNum(lp.from) + 1;
      if (after.length < 3 && after.every(w => w.data.deload || w.data.deloadSkipped)) return { active: true, part: after.length + 1, reason: `${days} Tage Pause`, reentry: days };
    }
  }
  let marked = 0, cycleEnd = -1;
  ws.forEach((w, i) => { if (w.data.deload || w.data.deloadSkipped) { marked++; if (marked >= 3) { marked = 0; cycleEnd = i; } } });
  if (marked > 0) return { active: true, part: marked + 1, reason: 'Deload-Woche läuft' };
  const weeks = new Set(ws.slice(cycleEnd + 1).map(w => weekKey(w.ts))).size;
  const plat = plateauCount(p);
  if (weeks >= DELOAD_WEEKS) return { active: true, part: 1, reason: `${weeks} Trainingswochen seit dem letzten Deload` };
  if (weeks >= DELOAD_WEEKS_PLATEAU && plat >= 2) return { active: true, part: 1, reason: `Kein Fortschritt bei ${plat} Übungen` };
  return { active: false, weeks };
}
const deloadW = W => (W > 0 ? W * 0.9 : W < 0 ? W * 1.1 : 0);

/* ---------- Plan-Abgleich ---------- */
const SHARED_FIELDS = ['name', 'type', 'sets', 'min', 'max', 'warmup'];
function fieldChanges(a, b, sharedOnly) {
  const c = [];
  if (a.name !== b.name) c.push('Name');
  if (a.type !== b.type) c.push(`Art ${TYPE_LABEL[a.type]} → ${TYPE_LABEL[b.type]}`);
  if (a.sets !== b.sets) c.push(`Sätze ${a.sets} → ${b.sets}`);
  if (a.min !== b.min || a.max !== b.max) c.push(`${isTimed(b.type) ? 'Sek.' : 'Wdh.'} ${a.min}–${a.max} → ${b.min}–${b.max}`);
  if (!!a.warmup !== !!b.warmup) c.push(b.warmup ? 'Aufwärmsatz an' : 'Aufwärmsatz aus');
  if (sharedOnly) return c;
  if (!isTimed(b.type) && (a.step || 0) !== (b.step || 0)) c.push(`Steigerung ${fmtN(a.step || 0)} → ${fmtN(b.step || 0)} kg`);
  if ((a.cue || '') !== (b.cue || '')) c.push('Ausführung');
  if ((a.video || '') !== (b.video || '')) c.push('Video');
  if ((a.image || '') !== (b.image || '')) c.push('Bild');
  if (!!a.personal !== !!b.personal) c.push(b.personal ? 'jetzt abweichend (nur ich)' : 'jetzt gemeinsam');
  return c;
}
function diffPlan(from, to, sharedOnly) {
  const out = [];
  if ((from.title || '') !== (to.title || '')) out.push({ k: 'title', a: from.title, b: to.title });
  if ((from.short || '') !== (to.short || '')) out.push({ k: 'short', a: from.short, b: to.short });
  const fm = new Map(from.exercises.map(x => [x.id, x])), tm = new Map(to.exercises.map(x => [x.id, x]));
  to.exercises.forEach(x => {
    if (!fm.has(x.id)) {
      if (x.replaces && fm.has(x.replaces) && !tm.has(x.replaces)) out.push({ k: 'replace', a: fm.get(x.replaces).name, b: x.name });
      else out.push({ k: 'add', b: x.name });
    } else {
      const ch = fieldChanges(fm.get(x.id), x, sharedOnly);
      if (ch.length) out.push({ k: 'edit', b: x.name, ch });
    }
  });
  from.exercises.forEach(x => { if (!tm.has(x.id) && !to.exercises.some(y => y.replaces === x.id && !fm.has(y.id))) out.push({ k: 'remove', a: x.name }); });
  const common = to.exercises.filter(x => fm.has(x.id)).map(x => x.id).join();
  const commonFrom = from.exercises.filter(x => tm.has(x.id)).map(x => x.id).join();
  if (common !== commonFrom) out.push({ k: 'order' });
  return out;
}
function sharedDiff(mine, theirs) {
  const ignore = new Set([...mine.exercises, ...theirs.exercises].filter(x => x.personal).map(x => x.id));
  const f = p => ({ title: p.title, short: p.short, exercises: p.exercises.filter(x => !ignore.has(x.id)) });
  return diffPlan(f(mine), f(theirs), true);
}
function mergePlan(mine, theirs) {
  const tShared = theirs.exercises.filter(x => !x.personal);
  const tSharedIds = new Set(tShared.map(x => x.id));
  const tPersonal = new Set(theirs.exercises.filter(x => x.personal).map(x => x.id));
  const own = new Map(mine.exercises.map(x => [x.id, x]));
  const result = tShared.map(x => {
    const m = own.get(x.id);
    if (!m) { const n = clone(x); delete n.replaces; return n; }
    const n = clone(m); SHARED_FIELDS.forEach(f => { n[f] = x[f]; }); n.personal = false; delete n.replaces;
    if (isTimed(n.type)) n.step = 0;
    return n;
  });
  mine.exercises.forEach((x, i) => {
    if (tSharedIds.has(x.id) || !(x.personal || tPersonal.has(x.id))) return;
    let pos = 0;
    for (let j = i - 1; j >= 0; j--) { const idx = result.findIndex(y => y.id === mine.exercises[j].id); if (idx >= 0) { pos = idx + 1; break; } }
    result.splice(pos, 0, clone(x));
  });
  return { title: theirs.title, short: theirs.short, exercises: result };
}
const DIFF_SIGN = { add: '+', remove: '−', replace: '⇄', edit: '~', order: '↕', title: '~', short: '~', addday: '+', delday: '−' };
function diffText(d) {
  switch (d.k) {
    case 'add': return `Neu: ${d.b}`;
    case 'remove': return `Entfernt: ${d.a}`;
    case 'replace': return `${d.a} ersetzt durch ${d.b}`;
    case 'edit': return `${d.b}: ${(d.ch || []).join(', ')}`;
    case 'order': return 'Reihenfolge geändert';
    case 'title': return `Name des Tages: ${d.a} → ${d.b}`;
    case 'short': return `Kürzel: ${d.a} → ${d.b}`;
    case 'addday': return `Neuer Trainingstag: ${d.b}${d.t ? ' · ' + d.t : ''}`;
    case 'delday': return `Trainingstag gelöscht: ${d.a}`;
  }
  return '';
}
const diffList = list => `<ul class="diff">${list.map(d => `<li><span class="s">${DIFF_SIGN[d.k] || '~'}</span><span>${esc(diffText(d))}</span></li>`).join('')}</ul>`;

function bellItems() {
  const s = st(), me = cfg.me, out = [];
  // Planänderungen kommen nur aus der eigenen Crew, je Mitglied und Tag die letzte gemeinsame Änderung
  crewMates().forEach(other => DAYS.forEach(d => {
    const pc = s.lastShared[other + '|' + d];
    if (!pc) return;
    const mine = s.plans[me][d], theirs = s.plans[other][d];
    if (!mine && !theirs) return;
    const diff = !theirs ? [{ k: 'delday', a: mine.short }] : !mine ? [{ k: 'addday', b: theirs.short, t: theirs.title }] : sharedDiff(mine, theirs);
    if (!diff.length) return;
    const dec = s.decisions[me + '|' + pc.id];
    const myK = s.lastAction[me + '|' + d] ?? -1;
    const status = !dec && pc.k > myK ? 'open' : dec && dec.decision === 'dismissed' ? 'dismissed' : 'diverged';
    out.push({ day: d, pc, diff, status });
  }));
  return out;
}
const openCount = () => (cfg.me && cfg.me.length > 20 ? bellItems().filter(x => x.status === 'open').length + notices().length : 0);
/* ---------- Hinweise in der Glocke (nur für dich) ----------
   Regeneration: mindestens REGEN_H Stunden zwischen zwei gleichen Trainingstagen; dreimal unterschritten in 4 Wochen = Hinweis.
   Sätze: dreimal in Folge mehr bzw. weniger Sätze als im Plan = Vorschlag, den Plan anzupassen. */
function regenGaps(p) {
  const ws = st().workouts.filter(w => w.person === p).sort((a, b) => a.ts.localeCompare(b.ts)), out = [];
  ws.forEach((w, k) => {
    const prev = ws.slice(0, k).reverse().find(x => x.data.day === w.data.day);
    if (!prev) return;
    const h = (new Date(w.data.start || w.ts) - new Date(prev.ts)) / 36e5;
    if (h < REGEN_H) out.push({ w, h });
  });
  return out;
}
function notices() {
  if (!cfg.me) return [];
  const me = cfg.me, s = st(), ack = LS.get('notice.ack', {}), out = [];
  const since = Math.max(Date.now() - 28 * 864e5, +LS.get('regen.ack', 0));
  const gaps = regenGaps(me).filter(g => new Date(g.w.ts) > since);
  if (gaps.length >= 3) out.push({ id: 'regen', kind: 'regen', ts: gaps[gaps.length - 1].w.ts, title: 'Mehr auf Regeneration achten',
    text: `Du hast in den letzten 4 Wochen ${gaps.length}-mal weniger als ${REGEN_H} h Pause zwischen zwei gleichen Trainings gemacht. Muskeln wachsen in der Pause. Plane mehr Regeneration ein, z. B. mit der Rotation ${pdays(me, curPlan()).map(d => dl(d, me, curPlan())).join(' → ')}.` });
  pdays(me, curPlan()).forEach(d => planOf(me, curPlan())[d].exercises.forEach(x => {
    const h = normalSessions(me, x.id, x.type).slice(-3);
    if (h.length < 3) return;
    const cnt = sess => sess.sets.filter(st_ => int(st_.r) > 0 && st_.a !== 'r').length;
    const more = h.every(sess => cnt(sess) > x.sets), less = h.every(sess => rmOf(sess, 'zeit', 'erschoepft') > 0 && cnt(sess) < x.sets);
    if (!more && !less) return;
    const id = `sets-${x.id}-${h[2].wid}`;
    if (ack[id]) return;
    out.push({ id, kind: 'sets', ts: h[2].ts, day: d, title: `${x.name}: ${more ? 'öfter ein Satz mehr' : 'öfter ein Satz weniger'}`,
      text: more ? `Du hast die letzten 3 Male mehr als ${x.sets} Sätze gemacht. Plan auf ${Math.min(10, x.sets + 1)} Sätze anpassen?` : `Du hast die letzten 3 Male wegen Zeit oder Erschöpfung Sätze gestrichen. Plan auf ${Math.max(1, x.sets - 1)} ${x.sets - 1 === 1 ? 'Satz' : 'Sätze'} anpassen?` });
  }));
  s.wedits.forEach(e => {
    const id = 'edit-' + e.id;
    if (e.data.as !== me || ack[id] || Date.now() - new Date(e.ts) > 14 * 864e5) return;
    const w = s.workouts.find(x => x.id === e.data.ref); if (!w) return;
    out.push({ id, kind: 'edit', ts: e.ts, wid: w.id, title: `${pname(e.person)} hat dein Training angepasst`,
      text: `${dl(w.data.day)} vom ${fmtDate(w.ts)}: ${e.data.chg.length ? e.data.chg.join(' · ') : 'Werte korrigiert'}.` });
  });
  return out;
}
function noticeCard(n) {
  return `<section class="card notice n-${n.kind}" style="gap:10px">
    <div style="display:flex;align-items:center;gap:10px"><span class="nic" aria-hidden="true">${n.kind === 'regen' ? ICON.moon : n.kind === 'edit' ? ICON.swap : ICON.list}</span><div style="flex:1;display:flex;flex-direction:column"><b>${esc(n.title)}</b><span class="mono muted small">${fmtDate(n.ts)} · nur für dich</span></div></div>
    <span class="small">${esc(n.text)}</span>
    <div class="btnrow">${n.kind === 'sets' ? `<a class="btn small primary" href="#plan">Im Plan ändern</a>` : n.kind === 'edit' ? `<a class="btn small primary" href="#training-log:${encodeURIComponent(n.wid)}">Ansehen</a>` : ''}<button class="btn small ghost" data-act="notice-ok" data-id="${esc(n.id)}">${n.kind === 'sets' ? 'Ausblenden' : 'Verstanden'}</button></div>
  </section>`;
}

/* ---------- Synchronisation mit der Google-Tabelle ---------- */
const loader = {
  el: () => $('#loader'),
  show() { const l = this.el(); l.hidden = false; l.className = 'loader busy'; this.set(0, 'Verbinde …', ''); },
  // Balkenfarbe springt mit dem Fortschritt um: Gelb, ab 34 % Magenta, ab 67 % Cyan
  set(p, text, sub) {
    p = Math.max(0, Math.min(100, Math.round(p)));
    const l = this.el(), c = p < 34 ? ['#fff200', '#fff200'] : p < 67 ? ['#ec008c', '#ff4fb5'] : ['#00aeef', '#00aeef'];
    l.style.setProperty('--ldc', c[0]); l.style.setProperty('--ldt', c[1]);
    $('#ld-bar').style.width = p + '%'; $('#ld-track').setAttribute('aria-valuenow', p);
    $('#ld-pct').textContent = p + ' %';
    if (text != null) $('#ld-text').textContent = text;
    if (sub != null) $('#ld-sub').textContent = sub;
  },
  async error(text, sub) { const l = this.el(); l.className = 'loader error'; l.style.removeProperty('--ldc'); l.style.removeProperty('--ldt'); $('#ld-text').textContent = text; $('#ld-sub').textContent = sub || ''; await sleep(2200); },
  hide() { this.el().hidden = true; }
};
const mini = {
  show() { $('#topbar').hidden = false; this.set(4); },
  set(p) { $('#topbar i').style.width = Math.max(0, Math.min(100, p)) + '%'; },
  async error() {},
  hide() { setTimeout(() => { $('#topbar').hidden = true; this.set(0); }, 300); }
};
let syncing = null, syncError = null;
/* ---------- Abgleich mit Supabase ----------
   Bis 2.2 sprach die App mit einem Google-Skript („call“ mit action). Die Vault- und Galerie-Funktionen nutzen
   diese Schnittstelle weiter; sie wird hier auf Supabase-Tabellen abgebildet. */
const sbErr = e => {
  if (!e) return { code: 'server' };
  if (navigator.onLine === false) return { code: 'offline' };
  const m = String(e.message || e.msg || '');
  if (/fetch|network|Failed to/i.test(m)) return { code: 'network' };
  if (e.code === '23505') return { code: 'duplicate', msg: m };
  if (e.status === 401 || /JWT|not authenticated/i.test(m)) return { code: 'unauthorized' };
  return { code: e.code || 'server', msg: m };
};
async function call(body) {
  const me = cfg.me, a = body.action;
  const q = async p => { const r = await p; if (r.error) throw sbErr(r.error); return r.data; };
  if (a === 'vault_list') return { ok: true, entries: (await q(sb.from('vault').select('id,created').eq('user_id', me))) || [] };
  if (a === 'vault_get') { const r = await q(sb.from('vault').select('id,body').eq('id', body.id).eq('user_id', me).maybeSingle()); if (!r) throw { code: 'not_found' }; return { ok: true, chunks: [r.body] }; }
  if (a === 'vault_put') { await q(sb.from('vault').upsert({ user_id: me, id: body.id, created: body.created, body: body.chunks.join('') }, { onConflict: 'user_id,id' })); return { ok: true }; }
  if (a === 'vault_del') { await q(sb.from('vault').delete().eq('user_id', me).eq('id', body.id)); return { ok: true }; }
  // Spots und Chat laufen ab 3.0 über eigene Tabellen (Ende-zu-Ende pro Empfänger), siehe spotSync/chatSync
  return { ok: true, spots: [], entries: [], rows: [] };
}
const SYNC_ERR = {
  unauthorized: ['Abgemeldet', 'Bitte melde dich neu an.'],
  network: ['Keine Verbindung', 'Deine Einträge bleiben gespeichert und werden beim nächsten Öffnen gesendet.'],
  offline: ['Offline', 'Deine Einträge bleiben gespeichert und werden beim nächsten Öffnen gesendet.'],
  server: ['Sync fehlgeschlagen', 'Versuch es gleich noch einmal.']
};
// Alte Einträge (vor 3.0) nennen Personen beim Namen, z. B. „as: Rob“. Auf Profil-IDs abbilden.
const legacyId = n => { if (typeof n !== 'string' || n.length > 20) return n; const p = Object.values(PROFILES).find(x => x.legacy_name === n); return p ? p.id : n; };
function addSynced(ev) {
  if (!ev || !ev.id || seenIds.has(ev.id)) { if (ev && ev.seq > lastSeq) lastSeq = ev.seq; return; }
  let data = ev.data; if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = {}; } }
  if (data && typeof data.as === 'string') data = { ...data, as: legacyId(data.as) };
  events.push({ seq: ev.seq, id: ev.id, ts: ev.ts, person: ev.user_id, type: ev.type, summary: ev.summary, data: data || {}, private: !!ev.private, crew: ev.crew_id || null });
  seenIds.add(ev.id);
  if (ev.seq > lastSeq) lastSeq = ev.seq;
}
// Profile, Crew und Freunde laden. Liefert true, wenn sich die Personenliste geändert hat.
async function loadPeople() {
  const me = cfg.me; if (!me) return false;
  let [pr, fr, cm] = await Promise.all([
    sb.from('profiles').select('id,buddy_id,name,avatar_path,share_weight,legacy_name,week_goal,week_goal_next,week_goal_from,deleted_at,flame,flame_week,share_pause,kurz'),
    sb.from('friendships').select('a,b,status,requested_by'),
    sb.from('crew_members').select('crew_id,user_id,role,joined_at')
  ]);
  // Datenbank noch ohne Skript 11: ohne die neuen Felder laden
  if (pr.error) pr = await sb.from('profiles').select('id,buddy_id,name,avatar_path,share_weight,legacy_name,week_goal,week_goal_next,week_goal_from,deleted_at');
  if (pr.error) throw sbErr(pr.error);
  const friends = new Set((fr.data || []).filter(f => f.status === 'accepted').map(f => f.a === me ? f.b : f.a));
  const next = {};
  (pr.data || []).forEach(p => { next[p.id] = { ...p, friend: friends.has(p.id) }; });
  const before = PEOPLE.join();
  PROFILES = next; LS.set('profiles', PROFILES);
  const mem = (cm.data || []).slice().sort((x, y) => String(x.joined_at).localeCompare(String(y.joined_at)));
  if (mem.length) {
    const c = (await sb.from('crews').select('id,name,avatar_path,owner').eq('id', mem[0].crew_id).maybeSingle()).data;
    CREW = { id: mem[0].crew_id, name: c ? c.name : 'Crew', avatar_path: c ? c.avatar_path : null, owner: c ? c.owner : null, members: mem.map(m => m.user_id) };
  } else CREW = null;
  LS.set('crew', CREW);
  computePeople();
  try { await loadSocial(fr.data || []); await loadConsents(); } catch (e) { /* nicht kritisch */ }
  return before !== PEOPLE.join();
}
const evRow = e => ({ id: e.id, ts: e.ts, type: e.type, summary: e.summary || '', data: e.data || {}, private: !!e.private, crew_id: e.private ? null : (e.crew || (CREW ? CREW.id : null)) });
function sync({ overlay = false, quiet = false } = {}) {
  if (!cfg.me) return Promise.resolve({ ok: false, code: 'nocfg' });
  if (syncing) return syncing;
  const ui = overlay ? loader : mini;
  syncing = (async () => {
    await Promise.resolve();
    ui.show();
    try {
      if (navigator.onLine === false) throw { code: 'offline' };
      ui.set(4, 'Prüfe dein Konto …', '');
      const { data: ses } = await sb.auth.getSession();
      if (!ses || !ses.session) throw { code: 'unauthorized' };
      if (ses.session.user && ses.session.user.email && LS.get('acct.email', '') !== ses.session.user.email) LS.set('acct.email', ses.session.user.email);
      if (await loadPeople()) invalidate();
      // senden
      const toPush = pending.filter(p => !seenIds.has(p.id));
      let rejected = 0;
      for (let i = 0; i < toPush.length; i += 20) {
        const batch = toPush.slice(i, i + 20).map(evRow);
        let r = await sb.from('events').upsert(batch, { onConflict: 'id', ignoreDuplicates: true });
        if (r.error) { // einzeln versuchen, damit ein abgelehnter Eintrag (z. B. zweites Training am Tag) die anderen nicht aufhält
          if (sbErr(r.error).code === 'network') throw { code: 'network' };
          for (const row of batch) {
            const r1 = await sb.from('events').upsert([row], { onConflict: 'id', ignoreDuplicates: true });
            if (r1.error) { const c = sbErr(r1.error).code; if (c === 'network') throw { code: 'network' }; rejected++; pending = pending.filter(p => p.id !== row.id); }
          }
        }
        ui.set(4 + 36 * Math.min(1, (i + 20) / toPush.length), toPush.length ? `Sende ${toPush.length} ${toPush.length === 1 ? 'Eintrag' : 'Einträge'} …` : null, '');
      }
      // holen
      const start = lastSeq; let guard = 0;
      while (guard++ < 200) {
        const r = await sb.from('events').select('id,seq,user_id,ts,type,summary,data,private,crew_id').gt('seq', lastSeq).order('seq', { ascending: true }).limit(500);
        if (r.error) throw sbErr(r.error);
        (r.data || []).forEach(addSynced);
        ui.set(40 + 56 * Math.min(1, guard / 4), 'Lade Verlauf …', lastSeq > start ? `${events.length} Einträge` : 'Alles aktuell');
        if ((r.data || []).length < 500) break;
      }
      // Neue Buddys oder Crew-Mitglieder: deren ältere Einträge nachladen (lagen vor meinem letzten Stand)
      const full = LS.get('people.full', []), fresh = PEOPLE.filter(p => p !== cfg.me && !full.includes(p));
      if (fresh.length && start > 0) {
        let from = 0;
        for (let g2 = 0; g2 < 100; g2++) {
          const r = await sb.from('events').select('id,seq,user_id,ts,type,summary,data,private,crew_id').in('user_id', fresh).gt('seq', from).order('seq', { ascending: true }).limit(500);
          if (r.error) throw sbErr(r.error);
          const rows = r.data || []; const keep = lastSeq; rows.forEach(addSynced); lastSeq = Math.max(keep, lastSeq);
          if (rows.length < 500) break; from = rows[rows.length - 1].seq;
        }
        events.sort((a, b) => a.seq - b.seq); invalidate();
      }
      LS.set('people.full', PEOPLE.slice());
      pending = pending.filter(p => !seenIds.has(p.id));
      saveLog();
      // Bibliothek: fester Grundbestand (owner leer) und eigene bzw. Crew-Übungen
      ui.set(97, 'Lade Bibliothek …', '');
      await libPush();
      const lr = await sb.from('library').select('id,owner,crew_id,data,deleted,updated_at');
      if (!lr.error) { libSheet = (lr.data || []).filter(x => !x.deleted).map(libDbRow); LIBQ.forEach(q => { libSheet = libSheet.filter(r => r.id !== q.id); if (!q.deleted) libSheet.push(libDbRow(q)); }); LS.set('lib.sheet', libSheet); invalidate(); }
      lastSync = new Date().toISOString(); LS.set('lastSync', lastSync); syncError = null;
      ui.set(100, 'Fertig', '');
      if (overlay) await sleep(400);
      if (rejected && !quiet) toast(rejected === 1 ? 'Ein Eintrag wurde abgelehnt.' : `${rejected} Einträge wurden abgelehnt.`);
      setTimeout(() => { flushUsage(); pushFlame(); notesSync(); vaultSync().then(() => gallerySync()); spotSync().then(() => chatSync()); }, 0);
      return { ok: true };
    } catch (err) {
      const code = (err && err.code) || 'server';
      syncError = code;
      const [t, s] = SYNC_ERR[code] || SYNC_ERR.server;
      if (overlay) await ui.error(t, s);
      else if (!quiet) toast(t);
      return { ok: false, code };
    } finally {
      ui.hide(); syncing = null; invalidate(); safeRender();
    }
  })();
  return syncing;
}
// Bibliothekszeile aus der Datenbank → Format, das libFromRow versteht (alte Blattspalten oder neue Schlüssel)
const LIB_COL = { 'ID': 'id', 'Name': 'name', 'Art': 'art', 'Gruppe': 'gruppe', 'Hauptmuskeln': 'haupt', 'Nebenmuskeln': 'neben', 'Sätze': 'saetze', 'Spanne von': 'von', 'Spanne bis': 'bis', 'Ausführung': 'ausfuehrung', 'Video': 'video', 'Suchbegriffe': 'suche', 'Ausgeblendet': 'ausgeblendet', 'Zusammengeführt in': 'zusammen', 'Geändert am': 'geaendert', 'Geändert von': 'vonPerson' };
function libDbRow(x) {
  const r = {}; Object.entries(x.data || {}).forEach(([k, v]) => { r[LIB_COL[k] || k] = v; });
  r.id = x.id; r.owner = x.owner || null; r.crew = x.crew_id || null;
  return r;
}

/* ---------- Bilder verkleinern ---------- */
function loadImage(file) {
  return new Promise((res, rej) => { const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { URL.revokeObjectURL(url); res(img); }; img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Bild konnte nicht gelesen werden')); }; img.src = url; });
}
async function resizeImage(file, max, square) {
  const img = await loadImage(file);
  let w = img.naturalWidth, h = img.naturalHeight, sx = 0, sy = 0, sw = w, sh = h;
  if (square) { const m = Math.min(w, h); sx = (w - m) / 2; sy = (h - m) / 2; sw = sh = m; w = h = Math.min(max, m); }
  else { const f = Math.min(1, max / Math.max(w, h)); w = Math.round(w * f); h = Math.round(h * f); }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return c;
}
const canvasBlob = (c, q) => new Promise(r => c.toBlob(r, 'image/jpeg', q));

/* ---------- Vault: private Bilder, verschlüsselt ----------
   Schlüsselaufbau (ab 1.3):
   - Wiederherstellungsschlüssel: 160 Bit Zufall, einmal angezeigt (32 Zeichen). Nur die Person selbst kennt ihn.
   - Daraus abgeleitet: der Datenschlüssel (verschlüsselt Bilder und Notizen) und der Vault-Zugang für die Tabelle.
   - Auf dem Handy liegt der Wiederherstellungsschlüssel nur mit dem 4-stelligen Code verschlüsselt.
   - In die Tabelle gehen nur die schon verschlüsselten Einträge. Ohne den Schlüssel sind sie unlesbar. */
const b64e = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const VAULT = { picking: 0, key: null, raw: null, mode: 'unlock', pin: '', first: '', msg: '', bad: false, entries: null, urls: {}, fails: 0, until: 0, del: null, importData: null, photo: null, photoUrl: null, showKey: null, wantKey: false, restore: null };
const vmeta = () => LS.get('vault.' + cfg.me, null);
const vtoken = () => LS.get('vault.tok.' + cfg.me, null);
const IDB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('hb-vault', 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore('entries', { keyPath: 'id' }); s.createIndex('person', 'person'); };
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('entries', mode); const s = t.objectStore('entries'); const out = fn(s); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); }); },
  all(person) { return this.tx('readonly', s => s.index('person').getAll(person)); },
  get(id) { return this.tx('readonly', s => s.get(id)); },
  put(rec) { return this.tx('readwrite', s => s.put(rec)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); }
};
async function deriveKey(pin, saltB64) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(saltB64), iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encBytes(key, bytes) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes); return { iv: b64e(iv), ct: new Uint8Array(ct) }; }
async function decBytes(key, iv, ct) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(iv) }, key, ct)); }
const encJSON = (key, o) => encBytes(key, new TextEncoder().encode(JSON.stringify(o)));
const decJSON = async (key, iv, ct) => JSON.parse(new TextDecoder().decode(await decBytes(key, iv, ct)));

/* Wiederherstellungsschlüssel: 20 Byte, als 8 Vierergruppen ohne verwechselbare Zeichen (kein 0/O, 1/I) */
const RK_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function rkEncode(raw) {
  let bits = '', out = '';
  raw.forEach(b => { bits += b.toString(2).padStart(8, '0'); });
  for (let i = 0; i < bits.length; i += 5) out += RK_ABC[parseInt(bits.slice(i, i + 5), 2)];
  return out.match(/.{4}/g).join('-');
}
function rkDecode(text) {
  const t = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1');
  if (t.length !== 32 || [...t].some(c => !RK_ABC.includes(c))) return null;
  const bits = [...t].map(c => RK_ABC.indexOf(c).toString(2).padStart(5, '0')).join('');
  return Uint8Array.from(bits.match(/.{8}/g), b => parseInt(b, 2));
}
async function rawKeys(raw) {
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const salt = new TextEncoder().encode('hantelbuch-vault-v2');
  const dk = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('daten') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const tb = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('zugang') }, base, 256));
  const gk = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('galerie') }, base, 256));
  return { dk, token: [...tb].map(b => b.toString(16).padStart(2, '0')).join(''), gk: b64e(gk) };
}
async function wrapMeta(pin, raw, saved) {
  const salt = b64e(crypto.getRandomValues(new Uint8Array(16)));
  const pk = await deriveKey(pin, salt);
  const w = await encBytes(pk, raw);
  return { v: 2, salt, wiv: w.iv, wrap: b64e(w.ct), saved: !!saved };
}
/* Öffnet den Vault mit dem Code. Liefert { dk, raw } oder null. Alte Vaults (1.2) haben noch keinen raw-Schlüssel. */
async function openMeta(pin, meta) {
  try {
    const pk = await deriveKey(pin, meta.salt);
    if (meta.v === 2) { const raw = await decBytes(pk, meta.wiv, b64d(meta.wrap)); const k = await rawKeys(raw); return { dk: k.dk, raw, token: k.token, gk: k.gk }; }
    const o = await decJSON(pk, meta.civ, b64d(meta.check));
    return o && o.v === 'hantelbuch-vault' ? { dk: pk, raw: null } : null;
  } catch (e) { return null; }
}
async function unlocked(res) {
  VAULT.key = res.dk; VAULT.raw = res.raw;
  if (res.token) LS.set('vault.tok.' + cfg.me, res.token);
  if (res.gk) LS.set('gal.key.' + cfg.me, res.gk);
  if (res.raw) ckAfterUnlock();
}
/* Umstellung eines alten Vaults (nur mit Code verschlüsselt) auf den Wiederherstellungsschlüssel */
async function migrateVault(pin) {
  const raw = crypto.getRandomValues(new Uint8Array(20));
  const k = await rawKeys(raw);
  await reencryptAll(VAULT.key, k.dk);
  LS.set('vault.' + cfg.me, await wrapMeta(pin, raw, false));
  await unlocked({ dk: k.dk, raw, token: k.token, gk: k.gk });
  VAULT.showKey = rkEncode(raw);
}
async function reencryptAll(oldKey, newKey) {
  for (const r of await IDB.all(cfg.me)) {
    const m = await decBytes(oldKey, r.miv, new Uint8Array(r.meta));
    const i = await decBytes(oldKey, r.iiv, new Uint8Array(r.img));
    const em = await encBytes(newKey, m), ei = await encBytes(newKey, i);
    await IDB.put({ ...r, miv: em.iv, meta: em.ct.buffer, iiv: ei.iv, img: ei.ct.buffer, up: false });
  }
}
async function loadVault() {
  const recs = await IDB.all(cfg.me);
  const list = [];
  for (const r of recs) { try { const m = await decJSON(VAULT.key, r.miv, new Uint8Array(r.meta)); list.push({ ...m, id: r.id, created: r.created }); } catch (e) { /* falscher Schlüssel: überspringen */ } }
  list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.created || '').localeCompare(a.created || ''));
  VAULT.entries = list;
}
function lockVault() {
  Object.values(VAULT.urls).forEach(u => URL.revokeObjectURL(u));
  Object.assign(VAULT, { key: null, raw: null, entries: null, urls: {}, pin: '', first: '', msg: '', mode: 'unlock', del: null, importData: null, showKey: null, restore: null });
  if (VAULT.photoUrl) URL.revokeObjectURL(VAULT.photoUrl);
  VAULT.photo = null; VAULT.photoUrl = null;
}
async function fillVaultImages() {
  if (!VAULT.key) return;
  const imgs = document.querySelectorAll('img[data-vimg]');
  for (const el of imgs) {
    const id = el.dataset.vimg;
    if (!VAULT.urls[id]) {
      try {
        const rec = await IDB.get(id);
        const bytes = await decBytes(VAULT.key, rec.iiv, new Uint8Array(rec.img));
        VAULT.urls[id] = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      } catch (e) { continue; }
    }
    if (document.body.contains(el)) el.src = VAULT.urls[id];
  }
}
async function pinComplete() {
  const pin = VAULT.pin; VAULT.pin = '';
  const fail = msg => { VAULT.msg = msg; VAULT.bad = true; render(); setTimeout(() => { VAULT.bad = false; }, 400); };
  const meta = vmeta();
  if (VAULT.mode === 'set1' || VAULT.mode === 'new1') { VAULT.first = pin; VAULT.mode = VAULT.mode === 'set1' ? 'set2' : 'new2'; VAULT.msg = ''; render(); return; }
  if (VAULT.mode === 'set2') {
    if (pin !== VAULT.first) { VAULT.mode = 'set1'; VAULT.first = ''; return fail('Die Codes stimmen nicht überein. Bitte noch einmal.'); }
    const restoring = !!VAULT.restore;
    VAULT.msg = restoring ? 'Stelle Vault wieder her …' : 'Lege Vault an …'; render();
    if (restoring) {
      // Ersetzt einen auf diesem Handy neu angelegten Vault: dessen Einträge passen nicht zum alten Schlüssel
      for (const r of await IDB.all(cfg.me)) await IDB.del(r.id);
      LS.set('vault.tomb.' + cfg.me, []); LS.set('vault.cloud.' + cfg.me, null);
    }
    const raw = restoring ? VAULT.restore.raw : crypto.getRandomValues(new Uint8Array(20));
    const k = await rawKeys(raw);
    LS.set('vault.' + cfg.me, await wrapMeta(pin, raw, restoring));
    await unlocked({ dk: k.dk, raw, token: k.token, gk: k.gk });
    VAULT.entries = []; VAULT.mode = 'unlock'; VAULT.restore = null;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* optional */ }
    if (restoring) {
      VAULT.msg = 'Lade Bilder aus der Sicherung …'; render();
      const r = await vaultSync({ progress: (a, b) => { VAULT.msg = `Lade Bilder aus der Sicherung … ${a} von ${b}`; if (view === 'vault' && !VAULT.entries.length) render(); } });
      VAULT.msg = ''; await loadVault();
      toast(r && r.ok ? `${VAULT.entries.length} ${VAULT.entries.length === 1 ? 'Bild' : 'Bilder'} wiederhergestellt` : 'Laden unterbrochen. Der Rest kommt beim nächsten Öffnen.');
      render();
      // Eigene Spots gleich mitholen, nicht erst beim nächsten Öffnen der App
      gallerySync().then(() => { if (['profil', 'kamera'].includes(view)) safeRender(); });
      return;
    }
    VAULT.msg = ''; VAULT.showKey = rkEncode(raw);
    render(); return;
  }
  if (VAULT.mode === 'new2') {
    if (pin !== VAULT.first) { VAULT.mode = 'new1'; VAULT.first = ''; return fail('Die Codes stimmen nicht überein. Neuen Code noch einmal eingeben.'); }
    VAULT.msg = 'Speichere neuen Code …'; render();
    if (VAULT.raw) LS.set('vault.' + cfg.me, await wrapMeta(pin, VAULT.raw, meta && meta.saved));
    lockVault(); toast('Vault-Code geändert'); location.hash = '#einstellungen'; return;
  }
  if (Date.now() < VAULT.until) return fail(`Zu viele Versuche. Bitte ${Math.ceil((VAULT.until - Date.now()) / 1000)} Sekunden warten.`);
  if (VAULT.mode === 'import') {
    const res = await openMeta(pin, VAULT.importData.meta);
    if (!res) return fail('Falscher Code für dieses Backup.');
    VAULT.msg = 'Lade Backup …'; render();
    const n = await importBackup(VAULT.importData, res.dk);
    VAULT.importData = null; VAULT.mode = 'unlock'; VAULT.msg = ''; await loadVault(); toast(`${n} ${n === 1 ? 'Bild' : 'Bilder'} aus dem Backup geladen`); render(); vaultSync(); return;
  }
  VAULT.msg = 'Prüfe Code …'; render();
  const res = await openMeta(pin, meta);
  if (!res) { VAULT.fails++; if (VAULT.fails >= 5) { VAULT.until = Date.now() + 30000; VAULT.fails = 0; } return fail('Falscher Code.'); }
  VAULT.fails = 0; VAULT.msg = '';
  await unlocked(res);
  if (!res.raw) { VAULT.msg = 'Stelle den Vault auf Cloud-Sicherung um …'; render(); await migrateVault(pin); VAULT.msg = ''; }
  if (VAULT.mode === 'old') { VAULT.mode = 'new1'; render(); return; }
  if (VAULT.wantKey) { VAULT.wantKey = false; VAULT.showKey = rkEncode(VAULT.raw); }
  if (VAULT.importData) {
    if (VAULT.importData.meta.salt === vmeta().salt) { VAULT.msg = 'Lade Backup …'; render(); const n = await importBackup(VAULT.importData, VAULT.key); VAULT.importData = null; VAULT.msg = ''; toast(`${n} ${n === 1 ? 'Bild' : 'Bilder'} aus dem Backup geladen`); }
    else { VAULT.mode = 'import'; render(); return; }
  }
  await loadVault(); render(); vaultSync();
}
async function saveVaultEntry(form) {
  const f = new FormData(form);
  const err = m => { const e = $('#vn-err'); e.textContent = m; e.hidden = false; };
  if (!VAULT.photo) return err('Bitte zuerst ein Foto aufnehmen oder auswählen.');
  const date = String(f.get('date') || todayStr());
  const bw = num(f.get('bw'));
  const note = String(f.get('note') || '').trim().slice(0, 2000);
  const btn = $('#vn-save'); btn.disabled = true; btn.textContent = 'Speichere …';
  try {
    const canvas = await resizeImage(VAULT.photo, 1600, false);
    const blob = await canvasBlob(canvas, 0.82);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const em = await encJSON(VAULT.key, { date, note, bw: bw >= 30 && bw <= 300 ? bw : null });
    const ei = await encBytes(VAULT.key, bytes);
    await IDB.put({ id: uid(), person: cfg.me, created: new Date().toISOString(), miv: em.iv, meta: em.ct.buffer, iiv: ei.iv, img: ei.ct.buffer, up: false });
    if (VAULT.photoUrl) URL.revokeObjectURL(VAULT.photoUrl);
    VAULT.photo = null; VAULT.photoUrl = null;
    await loadVault(); toast('Im Vault gespeichert'); location.hash = '#vault';
    vaultSync();
  } catch (e) { btn.disabled = false; btn.textContent = 'Im Vault speichern'; err('Speichern fehlgeschlagen: ' + (e.message || e)); }
}
async function deleteVaultEntry(id) {
  const rec = await IDB.get(id);
  await IDB.del(id);
  if (rec && rec.up) { const t = LS.get('vault.tomb.' + cfg.me, []); t.push(id); LS.set('vault.tomb.' + cfg.me, t); }
  vaultSync();
}
async function exportVault() {
  const meta = vmeta(); if (!meta) return;
  const recs = await IDB.all(cfg.me);
  const data = { type: 'hantelbuch-vault', v: 1, person: cfg.me, created: new Date().toISOString(), meta, entries: recs.map(r => ({ id: r.id, created: r.created, miv: r.miv, meta: b64e(new Uint8Array(r.meta)), iiv: r.iiv, img: b64e(new Uint8Array(r.img)) })) };
  const name = `hantelbuch-vault-${cfg.me.toLowerCase()}-${todayStr()}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'BUILT Vault-Backup' }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast(`Backup mit ${recs.length} ${recs.length === 1 ? 'Bild' : 'Bildern'} erstellt`);
}
async function importBackup(data, srcKey) {
  const existing = new Set((await IDB.all(cfg.me)).map(r => r.id));
  let n = 0;
  for (const e of data.entries) {
    if (existing.has(e.id)) continue;
    const m = await decBytes(srcKey, e.miv, b64d(e.meta));
    const i = await decBytes(srcKey, e.iiv, b64d(e.img));
    const em = await encBytes(VAULT.key, m), ei = await encBytes(VAULT.key, i);
    await IDB.put({ id: e.id, person: cfg.me, created: e.created, miv: em.iv, meta: em.ct.buffer, iiv: ei.iv, img: ei.ct.buffer, up: false });
    n++;
  }
  return n;
}
async function readBackupFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.type !== 'hantelbuch-vault' || !data.meta || !Array.isArray(data.entries)) throw new Error();
    if (!vmeta()) { LS.set('vault.' + cfg.me, data.meta); }
    VAULT.importData = data;
    if (!VAULT.key) { toast('Gib den Code ein, mit dem das Backup erstellt wurde.'); VAULT.mode = 'unlock'; location.hash = '#vault'; render(); return; }
    VAULT.mode = 'import'; location.hash = '#vault'; render();
  } catch (e) { toast('Diese Datei ist kein Vault-Backup von BUILT.'); }
}

/* ---------- Vault-Sicherung in der Tabelle ----------
   Läuft still im Hintergrund, auch wenn der Vault gesperrt ist: Hoch- und runtergeladen werden nur die bereits
   verschlüsselten Einträge. Der persönliche Vault-Zugang sorgt dafür, dass niemand sonst sie abrufen kann. */
const VCHUNK = 45000;
let vaultSyncing = null, vaultQueued = null;
const vcloud = () => LS.get('vault.cloud.' + cfg.me, null);
function vaultSync({ progress } = {}) {
  // läuft schon ein Abgleich, kommt genau ein weiterer danach (z. B. für ein gerade gelöschtes Bild)
  if (vaultSyncing) { if (!vaultQueued) vaultQueued = vaultSyncing.then(() => { vaultQueued = null; return vaultSync({ progress }); }); return vaultQueued; }
  const tok = vtoken(), meta = vmeta();
  if (!cfg.url || !cfg.key || !tok || !meta || meta.v !== 2 || navigator.onLine === false) return Promise.resolve({ ok: false });
  if (scriptVersion != null && scriptVersion < 3) return Promise.resolve({ ok: false, code: 'script' });
  const me = cfg.me;
  const req = (action, extra = {}, timeout = 120000) => call({ action, person: me, vtoken: tok, ...extra }, timeout);
  vaultSyncing = (async () => {
    let changed = false;
    try {
      let cloud = [], fresh = false;
      cloud = ((await req('vault_list', {}, 30000)).entries || []).filter(c => !/^[gk]-/.test(c.id));
      fresh = !cloud.length;   // leere Sicherung (z. B. nach der Umstellung): alles hochladen, nichts löschen
      const inCloud = new Set(cloud.map(c => c.id));
      // gelöschte Bilder auch in der Tabelle entfernen
      const tombs = LS.get('vault.tomb.' + me, []);
      for (const id of [...tombs]) {
        if (inCloud.has(id)) { await req('vault_del', { id }, 30000); inCloud.delete(id); }
        tombs.splice(tombs.indexOf(id), 1); LS.set('vault.tomb.' + me, tombs);
      }
      const local = await IDB.all(me), have = new Set(local.map(r => r.id));
      // hochladen, was neu ist; was hochgeladen war und in der Tabelle fehlt, wurde auf einem anderen Gerät gelöscht
      for (const r of local) {
        if (r.up && !inCloud.has(r.id) && !fresh) { await IDB.del(r.id); changed = true; continue; }
        if (r.up && !fresh) continue;
        const body = JSON.stringify({ id: r.id, created: r.created, miv: r.miv, meta: b64e(new Uint8Array(r.meta)), iiv: r.iiv, img: b64e(new Uint8Array(r.img)) });
        const chunks = []; for (let i = 0; i < body.length; i += VCHUNK) chunks.push(body.slice(i, i + VCHUNK));
        await req('vault_put', { id: r.id, created: r.created, chunks });
        await IDB.put({ ...r, up: true }); inCloud.add(r.id);
      }
      // fehlende Einträge aus der Tabelle laden (neues Handy oder zweites Gerät)
      const missing = cloud.filter(c => inCloud.has(c.id) && !have.has(c.id) && !tombs.includes(c.id));
      for (let i = 0; i < missing.length; i++) {
        if (progress) progress(i, missing.length);
        const g = await req('vault_get', { id: missing[i].id });
        const e = JSON.parse(g.chunks.join(''));
        if (e.id !== missing[i].id) continue;
        await IDB.put({ id: e.id, person: me, created: e.created, miv: e.miv, meta: b64d(e.meta).buffer, iiv: e.iiv, img: b64d(e.img).buffer, up: true });
        changed = true;
      }
      LS.set('vault.cloud.' + me, { at: new Date().toISOString(), n: inCloud.size, err: null });
      return { ok: true };
    } catch (e) {
      const c = (e && e.code) || 'server';
      LS.set('vault.cloud.' + me, { ...(vcloud() || {}), err: c });
      return { ok: false, code: c };
    } finally {
      vaultSyncing = null;
      if (changed && VAULT.key && cfg.me === me) { await loadVault(); if (view === 'vault') render(); }
      if (view === 'einstellungen') safeRender();
    }
  })();
  return vaultSyncing;
}
async function startRestore() {
  const err = m => { const e = $('#rk-err'); e.textContent = m; e.hidden = false; };
  const raw = rkDecode($('#rk-in').value);
  if (!raw) return err('Der Schlüssel hat 32 Zeichen (8 Gruppen à 4). Bitte prüfe deine Eingabe.');
  const btn = $('#rk-go'); btn.disabled = true; btn.textContent = 'Prüfe Schlüssel …';
  try {
    const k = await rawKeys(raw);
    const list = ((await call({ action: 'vault_list' })).entries || []).filter(c => !/^[gk]-/.test(c.id));
    if (!list.length) throw { code: 'vault_none' };
    // Schlüssel prüfen: der neueste Eintrag muss sich damit öffnen lassen
    const last = list.slice().sort((a, b) => String(b.created).localeCompare(String(a.created)))[0];
    const e = JSON.parse((await call({ action: 'vault_get', id: last.id })).chunks.join(''));
    try { await decBytes(k.dk, e.miv, b64d(e.meta)); } catch (x) { throw { code: 'vault_denied' }; }
    // Zugang erst beim Festlegen des Codes übernehmen, damit ein abgebrochener Versuch den jetzigen Vault nicht stört
    VAULT.restore = { raw, n: list.length };
    VAULT.mode = 'set1'; location.hash = '#vault';
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Weiter';
    err(e.code === 'vault_denied' ? 'Dieser Schlüssel passt nicht zu deinem Vault.' : e.code === 'vault_none' ? 'Zu deinem Konto gibt es noch keine Vault-Sicherung.' : 'Keine Verbindung. Bitte später noch einmal versuchen.');
  }
}

/* ======================= Spot =======================
   Ein Bild für den anderen, 5 Sekunden sichtbar. Geteilt über das Blatt „Spots“ (verschlüsselt mit einem
   Schlüssel aus dem Sync-Schlüssel). Dort liegt ein Spot 3 Tage bzw. bis er gesehen wurde, höchstens 30 Tage.
   Die eigenen Spots bleiben in der Galerie auf dem Handy und werden über die Vault-Sicherung gesichert. */
const SPOT_LIFE = 3 * 864e5, SPOT_MAX = 30 * 864e5, SPOT_SHOW = 5000;
const SPOT_WORDS = ['DURCHGEPUMPT', 'ERLEDIGT', 'AUSGEPOWERT', 'ABGEHAKT', 'DURCHGEZOGEN', 'GESCHAFFT', 'PLATT', 'ABGERISSEN'];
const SPOT_EMOJI = ['💪', '🔥', '👏'];   // feste Auswahl beim Ansehen, jedes andere Emoji über die Tastatur
const SPOT = { inbox: [], gallery: [], urls: {}, facing: 'environment', stream: null, ed: null, view: null, galDel: null, ready: false };

const SDB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('hb-spots', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('gallery', { keyPath: 'id' }); r.result.createObjectStore('inbox', { keyPath: 'id' }); };
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(store, mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction(store, mode); const out = fn(t.objectStore(store)); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); }); },
  all(store) { return this.tx(store, 'readonly', s => s.getAll()); },
  get(store, id) { return this.tx(store, 'readonly', s => s.get(id)); },
  put(store, rec) { return this.tx(store, 'readwrite', s => s.put(rec)); },
  del(store, id) { return this.tx(store, 'readwrite', s => s.delete(id)); }
};
const spotUrl = rec => SPOT.urls[rec.id] || (SPOT.urls[rec.id] = URL.createObjectURL(new Blob([rec.img], { type: 'image/jpeg' })));
const spotSeenBy = (id, p) => { const s = st().spotSeen[id]; return !!(s && s.has(p)); };
async function loadSpots() {
  try {
    const me = cfg.me;
    SPOT.gallery = (await SDB.all('gallery')).filter(g => g.person === me).sort((a, b) => a.created.localeCompare(b.created));
    SPOT.inbox = (await SDB.all('inbox')).filter(x => x.person !== me && PEOPLE.includes(x.person)).sort((a, b) => a.created.localeCompare(b.created));
  } catch (e) { SPOT.gallery = []; SPOT.inbox = []; }
  SPOT.ready = true;
}
const unseenSpots = () => SPOT.inbox.filter(x => !spotSeenBy(x.id, cfg.me) && Date.now() - new Date(x.created) < SPOT_MAX);

/* Schlüssel für geteilte Spots: aus dem Sync-Schlüssel abgeleitet, beide Handys kommen auf denselben */
let _spotKey = null, _spotKeyFor = null;
async function spotKey() {
  if (_spotKey && _spotKeyFor === cfg.key) return _spotKey;
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(cfg.key), 'HKDF', false, ['deriveKey']);
  _spotKey = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('hantelbuch-spots'), info: new TextEncoder().encode('spots') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  _spotKeyFor = cfg.key; return _spotKey;
}
const chunk = str => { const out = []; for (let i = 0; i < str.length; i += VCHUNK) out.push(str.slice(i, i + VCHUNK)); return out; };

let spotSyncing = null;
function spotSync() {
  if (spotSyncing) return spotSyncing;
  if (!cfg.me || cfg.key !== 'supabase' || navigator.onLine === false) return Promise.resolve();
  const me = cfg.me;
  /* Ab 3.0: Bild verschlüsselt im Speicher „spots/<ich>/<id>“, Angaben in der Tabelle „spots“. Ein Schlüssel pro Spot,
     verpackt für jeden Empfänger (alle Buddys und die Crew) wie beim Chat. Empfänger stehen in „spot_recipients“. */
  spotSyncing = (async () => {
    let changed = false;
    try {
      if (!(await ensureChatKey())) return;
      const lr = await sb.from('spots').select('id,owner,created_at,iv,ct,keys,file_path');
      if (lr.error) throw lr.error;
      const list = lr.data || [], inDb = new Set(list.map(x => x.id)), now = Date.now();
      const tombs = LS.get('spot.tomb.' + me, []);
      const drop = async x => { await sb.from('spots').delete().eq('id', x.id); if (x.file_path) await sb.storage.from('spots').remove([x.file_path]); inDb.delete(x.id); };
      for (const id of [...tombs]) { const x = list.find(y => y.id === id); if (x) await drop(x); tombs.splice(tombs.indexOf(id), 1); LS.set('spot.tomb.' + me, tombs); }
      // eigene, noch nicht geteilte Spots hochladen
      for (const g of await SDB.all('gallery')) {
        if (g.person !== me || g.shared || now - new Date(g.created) > SPOT_LIFE) continue;
        const to = others().filter(p => PROFILES[p] && (PROFILES[p].friend || crewMates().includes(p)));
        const rcpts = {}; for (const p of to) { const pub = await peerPub(p); if (pub) rcpts[p] = pub; }
        const mk = crypto.getRandomValues(new Uint8Array(32)), key = await crypto.subtle.importKey('raw', mk, 'AES-GCM', false, ['encrypt']);
        const img = await encBytes(key, new Uint8Array(g.img));
        const path = `${me}/${g.id}`;
        const up = await sb.storage.from('spots').upload(path, img.ct, { contentType: 'application/octet-stream', upsert: true });
        if (up.error) throw up.error;
        const meta = await encJSON(key, { meta: g.meta || {}, iiv: img.iv, created: g.created });
        const keys = { _pk: CK.pub };
        for (const [id, pub] of Object.entries({ ...rcpts, [me]: CK.pub })) { const w = await encBytes(await sharedKey(pub), mk); keys[id] = w.iv + '.' + b64e(w.ct); }
        // nur anlegen (Ändern ist nicht erlaubt); gibt es ihn schon, war ein früherer Versuch erfolgreich
        const ins = await sb.from('spots').insert({ id: g.id, created_at: g.created, expires_at: new Date(new Date(g.created).getTime() + SPOT_MAX).toISOString(), iv: meta.iv, ct: b64e(meta.ct), keys, file_path: path });
        if (ins.error && sbErr(ins.error).code !== 'duplicate') throw ins.error;
        const rr = Object.keys(rcpts).map(user_id => ({ spot_id: g.id, user_id }));
        if (rr.length) await sb.from('spot_recipients').upsert(rr, { onConflict: 'spot_id,user_id', ignoreDuplicates: true });
        await SDB.put('gallery', { ...g, shared: true, to: Object.keys(rcpts) }); inDb.add(g.id); changed = true;
      }
      // eigene aufräumen: nach 3 Tagen, wenn alle Empfänger ihn gesehen haben; sonst spätestens nach 30 Tagen
      const mineG = await SDB.all('gallery');
      for (const x of list) {
        if (x.owner !== me) continue;
        const age = now - new Date(x.created_at), g = mineG.find(y => y.id === x.id), to = (g && g.to) || others();
        if ((age > SPOT_LIFE && to.every(o => spotSeenBy(x.id, o))) || age > SPOT_MAX) await drop(x);
      }
      // neue Spots der anderen laden und entschlüsseln
      const have = new Set((await SDB.all('inbox')).map(x => x.id));
      for (const x of list) {
        if (x.owner === me || !PEOPLE.includes(x.owner) || have.has(x.id) || spotSeenBy(x.id, me) || now - new Date(x.created_at) > SPOT_MAX) continue;
        try {
          const k = x.keys || {}, w = k[me]; if (!w || !k._pk) continue;
          const [wiv, wct] = w.split('.');
          const mk = await decBytes(await sharedKey(k._pk), wiv, b64d(wct));
          const key = await crypto.subtle.importKey('raw', mk, 'AES-GCM', false, ['decrypt']);
          const meta = await decJSON(key, x.iv, b64d(x.ct));
          const dl_ = await sb.storage.from('spots').download(x.file_path); if (dl_.error) continue;
          const bytes = await decBytes(key, meta.iiv, new Uint8Array(await dl_.data.arrayBuffer()));
          await SDB.put('inbox', { id: x.id, person: x.owner, created: new Date(x.created_at).toISOString(), meta: meta.meta || {}, img: bytes.buffer });
          changed = true;
        } catch (e) { /* nicht lesbar: überspringen */ }
      }
      // Verschwundene aus dem Zwischenspeicher entfernen. Gesehene bleiben bis zum Ablauf der Spot-Frist.
      for (const x of await SDB.all('inbox')) if (!inDb.has(x.id) || (spotSeenBy(x.id, me) && now - new Date(x.created) > SPOT_LIFE)) { await SDB.del('inbox', x.id); changed = true; }
    } catch (e) { /* nächster Versuch beim nächsten Sync */ }
    finally {
      spotSyncing = null;
      if (changed) { await loadSpots(); if (!SPOT.view && !SPOT.ed && ['start', 'kamera', 'profil', ''].includes(view)) safeRender(); }
    }
  })();
  return spotSyncing;
}

/* Galerie-Sicherung: über die Vault-Sicherung (eigener Zugang), verschlüsselt mit einem Schlüssel aus dem
   Wiederherstellungsschlüssel. IDs mit „g-“ gehören zur Galerie. */
let gallerySyncing = null;
async function galKey() {
  const raw = LS.get('gal.key.' + cfg.me, null); if (!raw) return null;
  return crypto.subtle.importKey('raw', b64d(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
function gallerySync() {
  if (gallerySyncing) return gallerySyncing;
  const tok = vtoken(), meta = vmeta();
  if (!cfg.url || !cfg.key || !tok || !meta || meta.v !== 2 || !LS.get('gal.key.' + cfg.me, null) || navigator.onLine === false || (scriptVersion != null && scriptVersion < 3)) return Promise.resolve();
  const me = cfg.me;
  const req = (action, extra = {}, t = 120000) => call({ action, person: me, vtoken: tok, ...extra }, t);
  gallerySyncing = (async () => {
    let changed = false;
    try {
      const key = await galKey();
      let cloud = [], fresh = false;
      cloud = ((await req('vault_list', {}, 30000)).entries || []).filter(c => c.id.startsWith('g-')); fresh = !cloud.length;
      const inCloud = new Set(cloud.map(c => c.id));
      const tombs = LS.get('gal.tomb.' + me, []);
      for (const id of [...tombs]) { if (inCloud.has('g-' + id)) { await req('vault_del', { id: 'g-' + id }, 30000); inCloud.delete('g-' + id); } tombs.splice(tombs.indexOf(id), 1); LS.set('gal.tomb.' + me, tombs); }
      const local = (await SDB.all('gallery')).filter(g => g.person === me), have = new Set(local.map(g => 'g-' + g.id));
      for (const g of local) {
        if (g.up && !inCloud.has('g-' + g.id) && !fresh) { await SDB.del('gallery', g.id); changed = true; continue; }
        if (g.up && !fresh) continue;
        const enc = await encBytes(key, new Uint8Array(g.img));
        const body = JSON.stringify({ id: g.id, created: g.created, meta: g.meta, iv: enc.iv, ct: b64e(enc.ct) });
        await req('vault_put', { id: 'g-' + g.id, created: g.created, chunks: chunk(body) });
        await SDB.put('gallery', { ...g, up: true }); inCloud.add('g-' + g.id);
      }
      for (const c of cloud) {
        if (have.has(c.id) || !inCloud.has(c.id) || tombs.includes(c.id.slice(2))) continue;
        const g = await req('vault_get', { id: c.id });
        const p = JSON.parse(g.chunks.join(''));
        const bytes = await decBytes(key, p.iv, b64d(p.ct));
        await SDB.put('gallery', { id: p.id, person: me, created: p.created, meta: p.meta || {}, img: bytes.buffer, shared: true, up: true });
        changed = true;
      }
    } catch (e) { /* später erneut */ }
    finally { gallerySyncing = null; if (changed) { await loadSpots(); if (!SPOT.view && !SPOT.ed && ['profil', 'kamera'].includes(view)) safeRender(); } }
  })();
  return gallerySyncing;
}

/* ======================= Chat =======================
   Einzelchats pro Person. Nachrichten liegen verschlüsselt im Blatt „Chat“ (Schlüssel aus dem Sync-Schlüssel, wie bei
   den Spots) und verschwinden dort nach 30 Tagen. Gesendete Spots stehen im Chat, solange sie noch sichtbar sind, sie
   werden dafür nicht extra gespeichert. Textantworten auf einen Spot sind Nachrichten mit Verweis auf den Spot. */
const CHAT_DAYS = 30, CHAT_LEN = 1000;
const CHAT = { msgs: [], hold: [], loaded: false };
const chatLS = () => 'chat.msgs.' + cfg.me;
function loadChat() {
  const raw = LS.get(chatLS(), []);
  // Nachrichten aus 2.2.1 nennen Personen beim Namen: auf Profil-IDs abbilden
  const all = (Array.isArray(raw) ? raw : []).filter(m => m && typeof m.id === 'string' && typeof m.text === 'string')
    .map(m => ({ ...m, from: legacyId(m.from), to: legacyId(m.to), ...(m.spotOwner ? { spotOwner: legacyId(m.spotOwner) } : {}) }));
  const known = m => PEOPLE.includes(m.from) && (PEOPLE.includes(m.to) || m.to === crewKey());
  CHAT.msgs = all.filter(known);
  CHAT.hold = all.filter(m => !known(m));   // Person (noch) nicht in der Liste: aufheben, nicht verwerfen
  const rd = chatReadMap(), rd2 = {}; Object.entries(rd).forEach(([k, v]) => { rd2[legacyId(k)] = v; });
  if (Object.keys(rd).some(k => legacyId(k) !== k)) LS.set('chat.read.' + cfg.me, rd2);
  pruneChat(); CHAT.loaded = true;
}
function pruneChat() { const lim = Date.now() - CHAT_DAYS * 864e5, keep = m => m.pend || new Date(m.ts).getTime() > lim; CHAT.msgs = CHAT.msgs.filter(keep); CHAT.hold = (CHAT.hold || []).filter(keep); }
function saveChat() { LS.set(chatLS(), [...CHAT.msgs, ...(CHAT.hold || [])]); }
// Chat-Partner: eine Person oder die Crew („crew:<id>“, Nachrichten an alle Mitglieder)
const chatWith = p => CHAT.msgs.filter(m => (isCrewKey(p) ? m.to === p : (m.from === p && m.to === cfg.me) || (m.from === cfg.me && m.to === p)));
const chatTargets = () => [...others(), ...(crewKey() ? [crewKey()] : [])];
const chatReadMap = () => LS.get('chat.read.' + cfg.me, {}) || {};
const chatUnread = p => { const r = chatReadMap()[p] || ''; return chatWith(p).filter(m => m.from !== cfg.me && !m.react && m.ts > r).length; };
const chatUnreadAll = () => chatTargets().reduce((a, p) => a + chatUnread(p), 0);
function chatMarkRead(p) {
  const last = chatWith(p).filter(m => m.from !== cfg.me).map(m => m.ts).sort().pop(); if (!last) return;
  const r = chatReadMap(); if (r[p] === last) return; r[p] = last; LS.set('chat.read.' + cfg.me, r);
}
const chatPeers = () => chatTargets().filter(p => chatWith(p).length).sort((a, b) => (chatWith(b).pop().ts).localeCompare(chatWith(a).pop().ts));

/* ---------- Chat-Schlüssel (ab 3.0) ----------
   Jedes Konto hat ein Schlüsselpaar (ECDH P-256). Der öffentliche Teil liegt in „keys“, der private nur auf dem Handy
   und, mit dem Vault-Schlüssel verschlüsselt, als Eintrag „k-chat“ in der Vault-Sicherung. Ein neues Handy holt ihn
   von dort, sobald der Vault geöffnet wird. Jede Nachricht hat einen eigenen Schlüssel, der für Absender und
   Empfänger einzeln verpackt wird (Schlüssel aus ECDH der beiden Paare). Der Server sieht nur verschlüsselte Daten. */
const ECDH_P = { name: 'ECDH', namedCurve: 'P-256' };
const CK = { priv: null, pub: null, state: 'none', peers: {}, shared: {} };   // state: none | ok | vault (wartet auf Vault)
const ckLS = () => 'chat.key.' + cfg.me;
async function ckImport(jwk) { return crypto.subtle.importKey('jwk', jwk, ECDH_P, false, ['deriveBits']); }
async function ckSet(o) { CK.priv = await ckImport(o.jwk); CK.pub = o.pub; CK.state = 'ok'; CK.shared = {}; }
async function ckBackup(o) {
  if (!VAULT.key || !VAULT.raw) return false;
  const enc = await encJSON(VAULT.key, o);
  const r = await sb.from('vault').upsert({ user_id: cfg.me, id: 'k-chat', created: new Date().toISOString(), body: JSON.stringify({ id: 'k-chat', pub: o.pub, iv: enc.iv, ct: b64e(enc.ct) }) }, { onConflict: 'user_id,id' });
  if (r.error) return false;
  LS.set(ckLS(), { ...o, backed: true }); return true;
}
async function ckCreate() {
  const kp = await crypto.subtle.generateKey(ECDH_P, true, ['deriveBits']);
  const o = { jwk: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64e(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))), backed: false };
  const r = await sb.from('keys').upsert({ user_id: cfg.me, device_id: 'konto', public_key: o.pub, revoked_at: null }, { onConflict: 'user_id,device_id' });
  if (r.error) throw sbErr(r.error);
  LS.set(ckLS(), o); await ckSet(o); await ckBackup(o);
}
// Holt den privaten Schlüssel aus der Vault-Sicherung (nach dem Öffnen des Vaults)
async function ckFromVault() {
  if (!VAULT.key) return false;
  const r = await sb.from('vault').select('body').eq('user_id', cfg.me).eq('id', 'k-chat').maybeSingle();
  if (r.error || !r.data) return false;
  try {
    const b = JSON.parse(r.data.body); const o = await decJSON(VAULT.key, b.iv, b64d(b.ct));
    if (!o || !o.jwk || o.pub !== CK.serverPub) return false;
    LS.set(ckLS(), { ...o, backed: true }); await ckSet(o); return true;
  } catch (e) { return false; }
}
async function ensureChatKey() {
  if (CK.state === 'ok' && CK.for === cfg.me) return true;
  CK.for = cfg.me; CK.state = 'none'; CK.peers = {}; CK.shared = {};
  const kr = await sb.from('keys').select('public_key').eq('user_id', cfg.me).eq('device_id', 'konto').is('revoked_at', null).maybeSingle();
  if (kr.error) throw sbErr(kr.error);
  CK.serverPub = kr.data ? kr.data.public_key : null;
  const local = LS.get(ckLS(), null);
  if (local && local.jwk && local.pub === CK.serverPub) { await ckSet(local); if (!local.backed) ckBackup(local); return true; }
  if (!CK.serverPub) { await ckCreate(); return true; }
  // Konto hat schon einen Schlüssel, dieses Handy noch nicht: aus dem Vault holen
  if (await ckFromVault()) return true;
  const hasBackup = await sb.from('vault').select('id').eq('user_id', cfg.me).eq('id', 'k-chat').maybeSingle();
  if (!hasBackup.error && !hasBackup.data) { await ckCreate(); return true; }   // keine Sicherung: neu anlegen (alte Nachrichten bleiben unlesbar)
  CK.state = 'vault'; return false;
}
// nach dem Öffnen des Vaults: wartenden Schlüssel holen bzw. eine fehlende Sicherung nachholen
async function ckAfterUnlock() {
  try {
    if (!cfg.me || cfg.key !== 'supabase') return;
    if (CK.state === 'vault' && CK.for === cfg.me) { if (await ckFromVault()) { chatSync(); safeRender(); } return; }
    const local = LS.get(ckLS(), null); if (local && local.jwk && !local.backed) await ckBackup(local);
  } catch (e) { /* später erneut */ }
}
async function peerPub(p) {
  if (CK.peers[p] !== undefined) return CK.peers[p];
  const r = await sb.from('keys').select('public_key').eq('user_id', p).eq('device_id', 'konto').is('revoked_at', null).maybeSingle();
  CK.peers[p] = r.error || !r.data ? null : r.data.public_key; return CK.peers[p];
}
async function sharedKey(pubB64) {
  if (CK.shared[pubB64]) return CK.shared[pubB64];
  const pub = await crypto.subtle.importKey('raw', b64d(pubB64), ECDH_P, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, CK.priv, 256);
  const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  CK.shared[pubB64] = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('built-chat-v3'), info: new TextEncoder().encode('nachricht') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return CK.shared[pubB64];
}
// verschlüsselt o für die Empfänger (Profil-ID → öffentlicher Schlüssel); der Absender ist immer dabei
async function sealMsg(o, rcpts) {
  const mk = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', mk, 'AES-GCM', false, ['encrypt']);
  const enc = await encJSON(key, o);
  const keys = { _pk: CK.pub };
  for (const [id, pub] of Object.entries({ ...rcpts, [cfg.me]: CK.pub })) { const w = await encBytes(await sharedKey(pub), mk); keys[id] = w.iv + '.' + b64e(w.ct); }
  return { iv: enc.iv, ct: b64e(enc.ct), keys };
}
async function openMsg(row) {
  const k = row.keys || {}; const w = k[cfg.me]; if (!w || !k._pk) return null;
  const [wiv, wct] = w.split('.');
  const mk = await decBytes(await sharedKey(k._pk), wiv, b64d(wct));
  const key = await crypto.subtle.importKey('raw', mk, 'AES-GCM', false, ['decrypt']);
  return decJSON(key, row.iv, b64d(row.ct));
}
// Alte Chats aus 2.2.1: einmalig mit dem alten Sync-Schlüssel öffnen und neu verschlüsseln (nur selbst gesendete)
async function legacyChatKey(k) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(k), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('hantelbuch-chat'), info: new TextEncoder().encode('chat') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function chatMigrateLegacy() {
  const old = LS.get('legacy.cfg', null); if (!old || !old.key || LS.get('chat.legacy.' + cfg.me, false)) return;
  const r = await sb.rpc('my_legacy_messages'); if (r.error) return;
  const rows = r.data || []; if (!rows.length) { LS.set('chat.legacy.' + cfg.me, true); return; }
  const key = await legacyChatKey(old.key); const lim = Date.now() - CHAT_DAYS * 864e5; let open = 0;
  for (const x of rows) {
    const drop = () => sb.rpc('drop_legacy_message', { mid: x.id });
    if (new Date(x.ts).getTime() < lim) { await drop(); continue; }
    let o; try { const [iv, ct] = String(x.body).split('.'); o = await decJSON(key, iv, b64d(ct)); } catch (e) { await drop(); continue; }
    const pub = x.recipient ? await peerPub(x.recipient) : null;
    if (!pub) { open++; continue; }                                  // Empfänger noch nicht übernommen: später
    if (typeof o.spotOwner === 'string') o.spotOwner = legacyId(o.spotOwner);
    const s = await sealMsg(o, { [x.recipient]: pub });
    const ins = await sb.from('messages').insert({ id: x.id, recipient: x.recipient, ts: x.ts, expires_at: new Date(new Date(x.ts).getTime() + CHAT_DAYS * 864e5).toISOString(), ...s });
    if (!ins.error || sbErr(ins.error).code === 'duplicate') await drop(); else open++;
  }
  if (!open) LS.set('chat.legacy.' + cfg.me, true);
}
let chatSyncing = null;
function chatSync() {
  if (!V3_CHAT) return Promise.resolve();
  if (chatSyncing) return chatSyncing;
  if (!cfg.me || cfg.key !== 'supabase' || navigator.onLine === false) return Promise.resolve();
  if (!CHAT.loaded) loadChat();
  else if (CHAT.hold.length) { saveChat(); loadChat(); }   // inzwischen bekannte Personen übernehmen
  chatSyncing = (async () => {
    let changed = false;
    try {
      if (!(await ensureChatKey())) return;
      await chatMigrateLegacy();
      const tombs = LS.get('chat.tomb.' + cfg.me, []);
      for (const id of [...tombs]) { const r = await sb.from('messages').delete().eq('id', id).eq('sender', cfg.me); if (r.error) throw sbErr(r.error); tombs.splice(tombs.indexOf(id), 1); LS.set('chat.tomb.' + cfg.me, tombs); }
      for (const m of CHAT.msgs.filter(x => x.pend && x.from === cfg.me)) {
        const crew = isCrewKey(m.to);
        if (crew && m.to !== crewKey()) { m.fail = true; m.pend = false; changed = true; continue; }   // Crew inzwischen verlassen
        const rcpts = {};
        for (const id of crew ? crewMates() : [m.to]) { const pub = await peerPub(id); if (pub) rcpts[id] = pub; }
        if (!crew && !rcpts[m.to]) continue;                               // Empfänger hat noch keinen Schlüssel: bleibt wartend
        const o = { text: m.text }; if (m.spot) { o.spot = m.spot; o.spotOwner = m.spotOwner; }
        if (m.re) o.re = m.re; if (m.react) o.react = m.react;
        const s = await sealMsg(o, rcpts);
        const r = await sb.from('messages').insert({ id: m.id, ...(crew ? { crew_id: CREW.id } : { recipient: m.to }), ts: m.ts, ...s });
        if (r.error && sbErr(r.error).code !== 'duplicate') { const c = sbErr(r.error).code; if (c === 'network') throw r.error; m.fail = true; changed = true; continue; }
        m.pend = false; m.sv = true; delete m.fail; changed = true;
      }
      if (changed) saveChat();
      const since = new Date(Date.now() - CHAT_DAYS * 864e5).toISOString();
      const lr = await sb.from('messages').select('id,sender,recipient,crew_id,ts,iv,ct,keys').gt('ts', since).order('ts', { ascending: true });
      if (lr.error) throw sbErr(lr.error);
      const list = lr.data || [];
      const have = new Set(CHAT.msgs.map(m => m.id)), onServer = new Set(list.map(x => x.id));
      for (const x of list) {
        if (have.has(x.id)) { const m = CHAT.msgs.find(y => y.id === x.id); if (m && !m.sv) { m.sv = true; changed = true; } continue; }
        const to = x.crew_id ? 'crew:' + x.crew_id : x.recipient;
        if (!PEOPLE.includes(x.sender) || !(PEOPLE.includes(to) || to === crewKey())) continue;
        try {
          const o = await openMsg(x);
          if (!o || typeof o.text !== 'string' || !o.text.trim()) continue;
          const m = { id: x.id, from: x.sender, to, ts: new Date(x.ts).toISOString(), text: o.text.slice(0, CHAT_LEN), sv: true };
          if (typeof o.spot === 'string' && PEOPLE.includes(o.spotOwner)) { m.spot = o.spot.slice(0, 64); m.spotOwner = o.spotOwner; }
          if (typeof o.re === 'string') m.re = o.re.slice(0, 64);
          if (m.re && isEmoji(o.react)) m.react = o.react;
          CHAT.msgs.push(m); changed = true;
        } catch (e) { /* nicht lesbar (anderer Schlüssel): überspringen */ }
      }
      // Was schon auf dem Server war und dort fehlt, wurde vom Absender gelöscht. Lokale Altnachrichten (ohne sv) bleiben.
      const n = CHAT.msgs.length;
      CHAT.msgs = CHAT.msgs.filter(m => m.pend || !m.sv || onServer.has(m.id));
      if (CHAT.msgs.length !== n) changed = true;
      CHAT.msgs.sort((a, b) => a.ts.localeCompare(b.ts)); pruneChat();
      if (changed) saveChat();
    } catch (e) { /* nächster Versuch beim nächsten Sync */ }
    finally { chatSyncing = null; if (changed) chatChanged(); }
  })();
  return chatSyncing;
}
function chatSend(to, text, ref = {}) {
  text = String(text || '').trim().slice(0, CHAT_LEN); if (!text || !chatTargets().includes(to)) return;
  if (!CHAT.loaded) loadChat();
  const m = { id: uid(), from: cfg.me, to, ts: new Date().toISOString(), text, pend: true };
  if (ref.spot) { m.spot = ref.spot; m.spotOwner = ref.spotOwner; }
  if (ref.re) m.re = ref.re; if (ref.react) m.react = ref.react;
  CHAT.msgs.push(m); saveChat(); chatChanged(); chatSync();
}
// Neue Nachrichten: im offenen Chat nur die Liste tauschen (Eingabe und Tastatur bleiben), sonst neu zeichnen
function chatChanged() {
  if (view === 'chat') {
    const el = $('#chat-msgs'), p = CHAT.open; if (!el || !p) return;
    const app = $('#app'), atEnd = app.scrollHeight - app.scrollTop - app.clientHeight < 120;
    el.innerHTML = chatMsgsHTML(p); chatMarkRead(p);
    if (atEnd) app.scrollTop = app.scrollHeight;
    return;
  }
  if (['start', 'chats', 'verlauf', 'plan', 'notizen', 'profil', 'glocke'].includes(view)) safeRender();
  else if (view === 'spot-bild') render();
}
function chatBtn() {
  const n = chatUnreadAll();
  return `<a class="iconbtn" href="#chats" aria-label="Chats${n ? ', ' + n + ' ungelesen' : ''}">${ICON.chat}${n ? `<span class="badge">${n}</span>` : ''}</a>`;
}

/* Reaktionen auf einen eigenen Spot: Emojis aus dem Log, Textantworten aus dem Chat */
function spotReactions(id) {
  const out = [], r = st().spotReacts[id] || {};
  Object.entries(r).forEach(([p, x]) => { if (p !== cfg.me) out.push({ p, emoji: x.emoji, ts: x.ts }); });
  CHAT.msgs.forEach(m => { if (m.spot === id && m.from !== cfg.me) out.push({ p: m.from, text: m.text, ts: m.ts }); });
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}
// klein unten rechts am Bild: Sprechblase mit Anzahl der Antworten, Emojis leicht versetzt übereinander
function reactBadges(id) {
  const rs = spotReactions(id); if (!rs.length) return '';
  const em = rs.filter(r => r.emoji), tx = rs.filter(r => r.text).length;
  return `<span class="rbadges">${tx ? `<span class="rb-tx" aria-label="${tx} ${tx === 1 ? 'Antwort' : 'Antworten'}">${ICON.bubble}${tx}</span>` : ''}${em.length ? `<span class="rb-em" aria-label="Reaktionen ${esc(em.map(r => r.emoji).join(' '))}">${em.slice(-4).map(r => `<span>${esc(r.emoji)}</span>`).join('')}</span>` : ''}</span>`;
}
const reactBubble = r => `<div class="rbub ${r.emoji ? 'emo' : ''}"><a class="rb-av" href="#profil:${encodeURIComponent(r.p)}" data-act="goprof" data-p="${esc(r.p)}" aria-label="Profil von ${nm(r.p)}">${avatar(r.p, 30)}</a><span>${esc(r.emoji || r.text)}</span></div>`;

/* ---------- Chat: Ansichten ---------- */
function viewChats() {
  if (!CHAT.loaded) loadChat();
  const peers = chatPeers();
  const rows = peers.map(p => {
    const last = chatWith(p).filter(m => !chatHidden().includes(m.id)).pop() || chatWith(p).pop(), n = chatUnread(p);
    return `<a class="crow" href="#chat:${encodeURIComponent(p)}">${avatar(p, 50)}<span class="crow-m"><span class="crow-h"><b>${nm(p)}</b><span class="mono small muted">${relDay(last.ts) === 'heute' ? fmtTime(last.ts) : fmtDate(last.ts)}</span></span><span class="crow-l"><span class="${n ? 'unread' : 'muted'}">${last.from === cfg.me ? 'Du: ' : ''}${last.spot ? '↩ Spot · ' : ''}${esc(last.text)}</span>${n ? `<span class="cnt">${n}</span>` : ''}</span></span></a>`;
  }).join('');
  return `<h1 class="display" style="font-size:30px">Chats</h1>
    ${CK.state === 'vault' ? `<section class="card notice"><b>Vault öffnen</b><span class="small">Deine Chats sind mit deinem Vault gesichert. Öffne einmal den Vault, dann kannst du sie auch auf diesem Handy lesen und schreiben.</span><a class="btn small" href="#vault" style="align-self:flex-start">Vault öffnen</a></section>` : ''}
    ${peers.length ? `<section class="card" style="padding:2px 16px;gap:0">${rows}</section>` : `<section class="card cempty"><span class="cempty-i">${ICON.chat.replace('width="20" height="20"', 'width="24" height="24"')}</span><b>Noch keine Chats</b><span class="small muted">Tippe auf +, um deinem Gym Buddy zu schreiben. Ein Chat erscheint hier, sobald die erste Nachricht da ist.</span></section>`}
    <span class="lockline">${ICON.lock.replace('width="22" height="22"', 'width="12" height="12"')}Verschlüsselt · Nachrichten verschwinden nach ${CHAT_DAYS} Tagen</span>
    <button class="fab" data-act="chat-new" aria-label="Neuer Chat">${ICON.plus.replace('width="16" height="16"', 'width="24" height="24"')}</button>`;
}
function chatNewSheet(q = '') {
  const list = chatTargets().filter(p => !q || pname(p).toLowerCase().includes(q.toLowerCase()));
  sheet(`<h2>Neuer Chat</h2>
    <label class="cn-search">${ICON.search.replace('<svg ', '<svg width="18" height="18" ')}<input id="cn-q" type="search" placeholder="Buddy-ID suchen" aria-label="Buddy-ID suchen" value="${esc(q)}" autocomplete="off"></label>
    <span class="eyebrow">Gym Buddys</span>
    <div class="cn-list">${list.map(p => `<button class="cn-row glass" data-act="chat-open" data-p="${esc(p)}">${avatar(p, 46)}<span><b>${nm(p)}</b><span class="small muted">${chatWith(p).length ? 'Chat fortsetzen' : 'Neuen Chat beginnen'}</span></span><span class="cn-go">Schreiben</span></button>`).join('') || '<div class="empty">Niemand gefunden.</div>'}</div>
    <a class="cn-add" href="#buddies" data-act="mclose"><span class="cn-plus">${ICON.plus.replace('width="16" height="16"', 'width="20" height="20"')}</span><span>Gym Buddy hinzufügen<br><span class="small">Über die GymBuddy-ID oder den QR-Code</span></span></a>
    <button class="btn ghost" data-act="mclose">Abbrechen</button>`);
}
// Spot im Chat: solange er verfügbar ist, öffnet Antippen ihn erneut (eigener in der Galerie-Ansicht, fremder im Ansehen)
function chatSpotThumb(id, owner) {
  const g = owner === cfg.me ? SPOT.gallery.find(x => x.id === id) : SPOT.inbox.find(x => x.id === id);
  if (!g || (owner === cfg.me && !spotLive(g, CHAT.open || partner()))) return `<span class="cs-mini gone">Spot<br>abge&shy;laufen</span>`;
  const img = `<img src="${spotUrl(g)}" alt="Spot von ${esc(owner === cfg.me ? 'dir' : owner)}">`;
  return owner === cfg.me ? `<a class="cs-mini" href="#spot-bild:${encodeURIComponent(id)}" aria-label="Deinen Spot öffnen">${img}</a>` : `<button type="button" class="cs-mini" data-act="spot-replay" data-id="${esc(id)}" aria-label="Spot von ${esc(owner)} ansehen">${img}</button>`;
}
// einen Spot des anderen (noch einmal) ansehen, zurück geht es dorthin, wo man herkam
function openSpotReplay(id) {
  const s = SPOT.inbox.find(x => x.id === id);
  if (!s) { toast('Der Spot ist abgelaufen'); return; }
  SPOT.view = { list: [s], i: 0, t0: 0, el: 0, paused: false, raf: 0, down: null, back: location.hash || '#start' };
  location.hash = '#spots';
}
function spotLive(g, p) {
  const age = Date.now() - new Date(g.created);
  return age < SPOT_MAX && !(age > SPOT_LIFE && spotSeenBy(g.id, p));
}
function chatMsgsHTML(p) {
  const me = cfg.me, lim = Date.now() - CHAT_DAYS * 864e5;
  const items = chatWith(p).map(m => ({ ts: m.ts, m }));
  SPOT.gallery.forEach(g => { if (g.person === me && g.shared && new Date(g.created).getTime() > lim) items.push({ ts: g.created, g }); });
  SPOT.inbox.forEach(x => { if (x.person === p) items.push({ ts: x.created, x }); });
  items.sort((a, b) => a.ts.localeCompare(b.ts));
  const hidden = new Set(chatHidden());
  let lastDay = '', out = '';
  items.forEach(({ ts, m, g, x }) => {
    const dk = dateKey(ts);
    if (dk !== lastDay) { lastDay = dk; out += `<div class="cday">${esc(relDay(ts) === 'heute' ? 'Heute' : relDay(ts) === 'gestern' ? 'Gestern' : fmtDate(ts))}</div>`; }
    if (x) {
      const seen = spotSeenBy(x.id, me), left = Math.max(1, Math.ceil((SPOT_LIFE - (Date.now() - new Date(x.created))) / 864e5));
      out += `<div class="cmsg them"><button type="button" class="cs-spot ${seen ? '' : 'new'}" data-act="spot-replay" data-id="${esc(x.id)}" aria-label="Spot von ${nm(p)} ansehen"><img src="${spotUrl(x)}" alt="">${seen ? '' : '<span class="cs-new">Neu · antippen</span>'}</button><span class="ctime">Spot · ${fmtTime(ts)}${seen ? ` · noch ${left} ${left === 1 ? 'Tag' : 'Tage'}` : ''}</span></div>`;
      return;
    }
    if (g) {
      if (!spotLive(g, p)) { out += `<div class="cmsg me"><span class="cs-gone">${ICON.cam.replace('width="22" height="22"', 'width="14" height="14"')}Spot abgelaufen</span><span class="ctime">${fmtTime(ts)}</span></div>`; return; }
      const seen = spotSeenBy(g.id, p), left = Math.max(1, Math.ceil((SPOT_LIFE - (Date.now() - new Date(g.created))) / 864e5));
      out += `<div class="cmsg me"><a class="cs-spot" href="#spot-bild:${encodeURIComponent(g.id)}"><img src="${spotUrl(g)}" alt="Dein Spot">${reactBadges(g.id)}</a><span class="ctime">Spot · ${fmtTime(ts)} · ${seen ? (Date.now() - new Date(g.created) < SPOT_LIFE ? `noch ${left} ${left === 1 ? 'Tag' : 'Tage'}` : 'gesehen') : 'noch nicht gesehen'}</span></div>`;
      return;
    }
    if (m.react || hidden.has(m.id)) return;
    const mine = m.from === me;
    const bub = `<div class="cbub">${chatQuote(m)}<span class="ctext">${esc(m.text)}</span></div>`;
    const body = m.spot ? `<div class="crep">${mine ? bub + chatSpotThumb(m.spot, m.spotOwner) : chatSpotThumb(m.spot, m.spotOwner) + bub}</div>` : bub;
    const name = `<span class="cname" style="color:${mine ? 'var(--fg)' : nameColor(m.from)}">${mine ? 'Du' : nm(m.from)}</span>`;
    out += `<div class="cmsg ${mine ? 'me' : 'them'}" id="cm-${esc(m.id)}" data-mid="${esc(m.id)}">${name}${body}${chatReacts(m.id)}<span class="ctime">${fmtTime(ts)}${m.fail ? ' · nicht zugestellt' : m.pend ? ' · wird gesendet' : ''}</span></div>`;
  });
  return out || `<div class="empty" style="margin:auto 0 0">Schreib ${nm(p)} die erste Nachricht.</div>`;
}
function viewChat(p) {
  if (!CHAT.loaded) loadChat();
  CHAT.open = p;
  const crew = isCrewKey(p);
  const sub = crew ? `Crew · ${['Du', ...crewMates().map(id => `<span style="color:${nameColor(id)}">${nm(id)}</span>`)].join(', ')}` : `${ICON.lock.replace('width="22" height="22"', 'width="12" height="12"')}verschlüsselt · ${CHAT_DAYS} Tage`;
  return `<div class="chat-head"><div class="chat-head-in">${backBtn('chats')}<a class="chat-prof" href="${crew ? '#crew' : '#profil:' + encodeURIComponent(p)}" ${crew ? '' : `data-act="goprof" data-p="${esc(p)}"`} aria-label="${crew ? 'Crew-Info' : 'Profil von ' + nm(p)}">${avatar(p, 36)}</a><span class="chat-who"><b>${nm(p)}</b><span class="lockline">${sub}</span></span>${crew ? `<span class="iconbtn" aria-label="Ende-zu-Ende verschlüsselt" style="margin-left:auto;opacity:.6">${ICON.lock.replace('width="22" height="22"', 'width="16" height="16"')}</span>` : ''}</div></div>
    <main class="view chat-view"><div class="chat-msgs" id="chat-msgs">${chatMsgsHTML(p)}</div></main>
    <form class="chat-bar" id="chatform" novalidate>${chatReplyBar(p)}
      <a class="iconbtn" href="#kamera" aria-label="Spot aufnehmen">${ICON.cam.replace('width="22" height="22"', 'width="20" height="20"')}</a>
      <label class="chat-in glass"><input id="chat-in" placeholder="Nachricht" aria-label="Nachricht an ${nm(p)}" autocomplete="off" enterkeyhint="send" maxlength="${CHAT_LEN}" value="${esc(CHAT.draft && CHAT.draft[p] || '')}"></label>
      <button class="chat-send" type="submit" aria-label="Senden">${ICON.send}</button>
    </form>`;
}
// Eigene Nachricht für beide löschen: verschwindet hier sofort und beim anderen mit dem nächsten Abgleich
function chatDelete(id, quiet) {
  const m = CHAT.msgs.find(x => x.id === id); if (!m || m.from !== cfg.me) return;
  // mit der Nachricht verschwinden auch die eigenen Reaktionen darauf
  const gone = [m, ...CHAT.msgs.filter(x => x.react && x.re === id && x.from === cfg.me)];
  CHAT.msgs = CHAT.msgs.filter(x => !gone.includes(x)); saveChat();
  const t = LS.get('chat.tomb.' + cfg.me, []); gone.forEach(x => { if (!x.pend) t.push(x.id); }); LS.set('chat.tomb.' + cfg.me, t);
  chatChanged(); chatSync(); if (!quiet) toast('Nachricht gelöscht');
}
/* Antworten: Zitat in der Blase in der Farbe der zitierten Person, eigene Nachrichten weiß. Antippen springt zum Original. */
function chatQuote(m) {
  if (!m.re) return '';
  const q = CHAT.msgs.find(x => x.id === m.re && !x.react);
  if (!q) return '<span class="cquote gone">Nachricht nicht mehr da</span>';
  const own = q.from === cfg.me;
  return `<button type="button" class="cquote" data-act="cm-jump" data-id="${esc(q.id)}" style="--qc:${own ? '#fff' : nameColor(q.from)};--qf:${own ? '#000' : AV_FILL[avIdx(q.from)]}"><b>${own ? 'Du' : nm(q.from)}</b><span>${esc(q.text.slice(0, 140))}</span></button>`;
}
// Reaktionen unter einer Nachricht: jedes Emoji einmal, ab zwei Reaktionen mit Anzahl
function chatReacts(id) {
  const rx = CHAT.msgs.filter(x => x.react && x.re === id); if (!rx.length) return '';
  return `<span class="creact" aria-label="Reaktionen: ${esc(rx.map(x => (x.from === cfg.me ? 'du ' : x.from + ' ') + x.react).join(', '))}">${[...new Set(rx.map(x => x.react))].map(esc).join('')}${rx.length > 1 ? `<i>${rx.length}</i>` : ''}</span>`;
}
const chatHidden = () => LS.get('chat.hidden.' + cfg.me, []) || [];
function chatReplyBar(p) {
  const r = CHAT.reply && CHAT.reply.p === p ? CHAT.msgs.find(x => x.id === CHAT.reply.id) : null;
  if (!r) return '';
  const own = r.from === cfg.me;
  return `<div class="chat-reply glass" id="chat-reply" style="--qc:${own ? '#fff' : nameColor(r.from)}"><span><b>Antwort an ${own ? 'dich' : esc(r.from)}</b><em>${esc(r.text.slice(0, 120))}</em></span><button type="button" data-act="cm-reply-x" aria-label="Antwort abbrechen">${ICON.x || '×'}</button></div>`;
}
function refreshReplyBar() {
  const f = $('#chatform'); if (!f) return;
  const old = $('#chat-reply'); if (old) old.remove();
  f.insertAdjacentHTML('afterbegin', chatReplyBar(CHAT.open));
}
// Eigene Reaktion setzen, wechseln oder (gleiches Emoji noch einmal) zurücknehmen. Reist verschlüsselt wie eine Nachricht.
function chatReact(id, emoji) {
  const m = CHAT.msgs.find(x => x.id === id); if (!m || m.react || !isEmoji(emoji)) return;
  const p = isCrewKey(m.to) ? m.to : m.from === cfg.me ? m.to : m.from;
  const old = CHAT.msgs.find(x => x.react && x.re === id && x.from === cfg.me);
  if (old) chatDelete(old.id, true);
  if (!old || old.react !== emoji) chatSend(p, emoji, { re: id, react: emoji });
}
/* Gedrückt halten: Reaktionen (wie in der Spot-Ansicht, + für ein eigenes Emoji), Antworten, Kopieren, Melden bzw. Löschen */
const CM_EMOJI = ['💪', '🔥', '👏'];
function openChatMenu(id, emojiMode) {
  const m = CHAT.msgs.find(x => x.id === id); if (!m) return;
  const mine = m.from === cfg.me, myR = (CHAT.msgs.find(x => x.react && x.re === id && x.from === cfg.me) || {}).react;
  const ic = (d) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  $('#modal').innerHTML = `<div class="cm-ov" data-act="mclose-bg"><div class="cm-box ${mine ? 'me' : 'them'}" role="dialog" aria-modal="true" aria-label="Nachricht von ${mine ? 'dir' : nm(m.from)}">
    <div class="cm-emo" role="group" aria-label="Reagieren">${CM_EMOJI.map(e => `<button type="button" data-act="cm-react" data-id="${esc(id)}" data-v="${e}" aria-label="Reagieren mit ${e}" aria-pressed="${myR === e}">${e}</button>`).join('')}<button type="button" class="cm-plus" data-act="cm-emoji" data-id="${esc(id)}" aria-label="Eigenes Emoji wählen" aria-pressed="${!!myR && !CM_EMOJI.includes(myR)}">${myR && !CM_EMOJI.includes(myR) ? esc(myR) : ICON.plus.replace('width="16" height="16"', 'width="20" height="20"')}</button></div>
    ${emojiMode ? `<form class="cm-emo-in" id="cm-emo-form" data-id="${esc(id)}" novalidate><input id="cm-emo-in" placeholder="Emoji tippen" aria-label="Eigenes Emoji als Reaktion" maxlength="16" autocomplete="off" enterkeyhint="send"><button class="btn small" type="submit">Senden</button></form>` : ''}
    <div class="cm-msg">${esc(m.text)}</div>
    ${emojiMode ? '<span class="small muted cm-hint">Tippe ein Emoji, auf der Tastatur über 😀 oder 🌐.</span>' : `<div class="cm-acts">
      <button type="button" data-act="cm-reply" data-id="${esc(id)}">Antworten${ic('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v6"/>')}</button>
      <button type="button" data-act="cm-copy" data-id="${esc(id)}">Kopieren${ic('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>')}</button>
      ${mine ? `<button type="button" class="danger-t" data-act="cm-del2" data-id="${esc(id)}">Für alle löschen${ic('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>')}</button>`
        : `<button type="button" class="danger-t" data-act="cm-report" data-id="${esc(id)}">Melden${ic('<path d="M5 21V4h11l-1.5 4L16 12H5"/>')}</button>`}
    </div>`}
  </div></div>`;
  if (emojiMode) setTimeout(() => { const i = $('#cm-emo-in'); if (i) i.focus(); }, 30);
}
// Gesten im Chat: nach rechts wischen = antworten, gedrückt halten = Menü, doppelt tippen = 🔥 (nur fremde Nachrichten)
let CG = null, CG_TAP = { id: '', t: 0 };
function cgReset() { if (CG) { clearTimeout(CG.lp); if (CG.row) { CG.row.style.transition = 'transform .18s ease-out'; CG.row.style.transform = ''; CG.row.classList.remove('rep-ready'); } } CG = null; }
document.addEventListener('pointerdown', ev => {
  if (view !== 'chat' || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
  const row = ev.target.closest('.cmsg[data-mid]');
  if (!row || ev.target.closest('a, .cs-spot, .cs-mini, .cquote')) return;
  CG = { row, id: row.dataset.mid, x0: ev.clientX, y0: ev.clientY, dx: 0, mode: null, t0: Date.now() };
  CG.lp = setTimeout(() => { if (CG && !CG.mode) { CG.mode = 'menu'; if (navigator.vibrate) navigator.vibrate(8); openChatMenu(CG.id); } }, 450);
});
document.addEventListener('pointermove', ev => {
  if (!CG || view !== 'chat') return;
  const dx = ev.clientX - CG.x0, dy = ev.clientY - CG.y0;
  if (!CG.mode) {
    if (Math.abs(dy) > 10 || dx < -10) { clearTimeout(CG.lp); CG = null; return; }
    if (dx > 10 && dx > Math.abs(dy)) { CG.mode = 'swipe'; clearTimeout(CG.lp); } else return;
  }
  if (CG.mode !== 'swipe') return;
  CG.dx = dx; const d = Math.max(0, Math.min(dx, 80));
  CG.row.style.transition = 'none'; CG.row.style.transform = `translateX(${d}px)`; CG.row.classList.toggle('rep-ready', d > 56);
});
document.addEventListener('pointerup', () => {
  if (!CG) return;
  const c = CG; clearTimeout(c.lp);
  if (c.mode === 'swipe' && c.dx > 56) { CHAT.reply = { p: CHAT.open, id: c.id }; refreshReplyBar(); const i = $('#chat-in'); if (i) i.focus(); }
  if (!c.mode && Date.now() - c.t0 < 300) {
    const m = CHAT.msgs.find(x => x.id === c.id);
    if (m && m.from !== cfg.me && CG_TAP.id === c.id && Date.now() - CG_TAP.t < 320) { chatReact(c.id, '🔥'); CG_TAP = { id: '', t: 0 }; }
    else CG_TAP = { id: c.id, t: Date.now() };
  }
  cgReset();
});
document.addEventListener('pointercancel', cgReset);
document.addEventListener('submit', e => {
  if (e.target.id !== 'cm-emo-form') return;
  e.preventDefault();
  const v = ($('#cm-emo-in').value || '').trim();
  if (!isEmoji(v)) { toast('Bitte ein einzelnes Emoji eingeben'); return; }
  chatReact(e.target.dataset.id, v); closeModal();
});
function chatSubmit() {
  const p = CHAT.open, inp = $('#chat-in'); if (!p || !inp) return;
  const t = inp.value.trim(); if (!t) return;
  inp.value = ''; if (CHAT.draft) delete CHAT.draft[p];
  const re = CHAT.reply && CHAT.reply.p === p ? CHAT.reply.id : '';
  CHAT.reply = null; refreshReplyBar();
  chatSend(p, t, re ? { re } : {});
  const app = $('#app'); app.scrollTop = app.scrollHeight;
}

/* Spot mit Reaktionen als Bild: Blasen unten rechts wie in der Ansicht */
async function spotWithReactions(g) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = spotUrl(g); });
  const W = img.naturalWidth, H = img.naturalHeight, k = W / 390;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, W, H);
  const avImgs = {};
  for (const p of PEOPLE) { const a = st().avatars[p]; if (a) avImgs[p] = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = a; }); }
  const rs = spotReactions(g.id), right = W - 16 * k, maxW = 250 * k, pad = 13 * k, avR = 15 * k;
  const lines = (t, w) => { const ws = t.split(/\s+/), out = []; let l = ''; ws.forEach(word => { const tryL = l ? l + ' ' + word : word; if (x.measureText(tryL).width > w && l) { out.push(l); l = word; } else l = tryL; }); if (l) out.push(l); return out; };
  let y = H - 40 * k;
  for (const r of rs.slice().reverse()) {
    const emo = !!r.emoji;
    x.font = emo ? `${26 * k}px system-ui, sans-serif` : `600 ${15 * k}px Geist, system-ui, sans-serif`;
    const lh = emo ? 30 * k : 20 * k, ls = emo ? [r.emoji] : lines(r.text, maxW - 2 * pad - avR);
    const tw = Math.max(...ls.map(l => x.measureText(l).width));
    const bw = tw + pad + avR + 8 * k, bh = ls.length * lh + (emo ? 12 : 18) * k, bx = right - bw, by = y - bh;
    x.fillStyle = 'rgba(0,0,0,.55)'; x.beginPath(); x.roundRect ? x.roundRect(bx, by, bw, bh, 18 * k) : x.rect(bx, by, bw, bh); x.fill();
    x.fillStyle = '#fff'; x.textBaseline = 'middle';
    ls.forEach((l, i) => x.fillText(l, bx + avR + 8 * k, by + (emo ? 6 : 9) * k + lh * (i + .5)));
    const cx = bx, cy = by + bh / 2;
    x.save(); x.beginPath(); x.arc(cx, cy, avR + 2 * k, 0, Math.PI * 2); x.fillStyle = '#000'; x.fill();
    x.beginPath(); x.arc(cx, cy, avR, 0, Math.PI * 2); x.clip();
    if (avImgs[r.p]) x.drawImage(avImgs[r.p], cx - avR, cy - avR, avR * 2, avR * 2);
    else { x.fillStyle = '#2a2a2a'; x.fillRect(cx - avR, cy - avR, avR * 2, avR * 2); x.fillStyle = '#fff'; x.font = `700 ${12 * k}px Unbounded, system-ui, sans-serif`; x.textAlign = 'center'; x.fillText(r.p[0], cx, cy); x.textAlign = 'start'; }
    x.restore();
    y = by - 10 * k;
  }
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.92));
}

/* ---------- Siegel: Regel „erste Zeile bestimmt die Breite“, danach festes Bild ---------- */
let _measure = null;
function inkBox(font, text) {
  _measure = _measure || document.createElement('canvas').getContext('2d');
  _measure.font = font; const m = _measure.measureText(text);
  return { w: m.actualBoundingBoxLeft + m.actualBoundingBoxRight, l: m.actualBoundingBoxLeft };
}
function sealLayout(ctx, dark) {
  const K = 100, day = !!ctx.tone;
  const hf = day ? '800 100px Unbounded' : '700 100px "Geist Mono"';
  const head = inkBox(hf, ctx.head), W = head.w;
  const main = dark ? '#000' : '#fff', soft = dark ? 'rgba(0,0,0,.66)' : 'rgba(255,255,255,.72)';
  let y = (day ? 0.77 : 0.73) * K;
  const items = [{ text: ctx.head, family: day ? 'Unbounded' : 'Geist Mono', weight: day ? 800 : 700, size: K, x: head.l, y, fill: day ? TONE_HEX[ctx.tone] : main }];
  ctx.lines.forEach(([text, role], i) => {
    const wt = role === 'sub' ? 700 : 500, b = inkBox(`${wt} 100px "Geist Mono"`, text), s = 100 * W / b.w;
    y += (i ? 0.075 : 0.10) * K + 0.73 * s;
    items.push({ text, family: 'Geist Mono', weight: wt, size: s, x: b.l * s / 100, y, fill: role === 'time' ? soft : main });
  });
  return { W, H: y + 2, items, shadow: dark ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.55)' };
}
function sealSVG(L) {
  const t = L.items.map(i => `<text x="${i.x.toFixed(2)}" y="${i.y.toFixed(2)}" font-family="${i.family === 'Unbounded' ? 'Unbounded' : 'Geist Mono'}" font-weight="${i.weight}" font-size="${i.size.toFixed(2)}" fill="${i.fill}">${esc(i.text)}</text>`).join('');
  return `<svg viewBox="0 0 ${L.W.toFixed(2)} ${L.H.toFixed(2)}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;overflow:visible;filter:drop-shadow(0 1px 3px ${L.shadow})">${t}</svg>`;
}
function drawSeal(c, L, x, y, scale) {
  c.save(); c.translate(x, y); c.scale(scale, scale);
  c.shadowColor = L.shadow; c.shadowBlur = 9; c.shadowOffsetY = 3;
  L.items.forEach(i => { c.font = `${i.weight} ${i.size}px ${i.family === 'Unbounded' ? 'Unbounded' : '"Geist Mono"'}`; c.fillStyle = i.fill; c.fillText(i.text, i.x, i.y); });
  c.restore();
}
const hashStr = s => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
function spotContext(at) {
  const date = `${pad2(at.getDate())}.${pad2(at.getMonth() + 1)}.${String(at.getFullYear()).slice(2)}`, time = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  if (draft) {
    const { done, tot } = workCount();
    const sub = done === 0 ? 'LOS GEHT’S' : done >= tot ? 'ALLE SÄTZE' : `SATZ ${done} VON ${tot}`;
    return { kind: 'live', day: draft.day, tone: DAY_TONE[draft.day], head: dl(draft.day, null, draft.plan), lines: [[sub, 'sub'], [`${date} · ${time}`, 'time']] };
  }
  const w = st().workouts.filter(x => x.person === cfg.me && dateKey(x.ts) === dateKey(at)).pop();
  if (w) return { kind: 'done', day: w.data.day, tone: DAY_TONE[w.data.day], head: dl(w.data.day), lines: [[SPOT_WORDS[hashStr(dateKey(at)) % SPOT_WORDS.length], 'sub'], [`${date} · ${time}`, 'time']] };
  return { kind: 'date', head: date, lines: [[`${time} UHR`, 'sub']] };
}
async function spotFonts() {
  try { await Promise.all(['800 100px Unbounded', '700 100px "Geist Mono"', '500 100px "Geist Mono"', '500 20px "Geist Mono"'].map(f => document.fonts.load(f))); } catch (e) { /* Ersatzschrift */ }
}

/* ---------- Kamera ---------- */
async function startCamera() {
  stopCamera();
  const v = $('#cam-v'); if (!v) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { camFallback(); return; }
  try {
    SPOT.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: SPOT.facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    if (view !== 'kamera') { stopCamera(); return; }
    const el = $('#cam-v'); if (!el) { stopCamera(); return; }
    el.srcObject = SPOT.stream; el.classList.toggle('mirror', SPOT.facing === 'user');
    await el.play().catch(() => {});
  } catch (e) { camFallback(); }
}
function stopCamera() { if (SPOT.stream) { SPOT.stream.getTracks().forEach(t => t.stop()); SPOT.stream = null; } }
function camFallback() { const f = $('#cam-fb'); if (f) f.hidden = false; }
function shoot() {
  const v = $('#cam-v'); if (!v || !v.videoWidth) { camFallback(); return; }
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
  const x = c.getContext('2d');
  if (SPOT.facing === 'user') { x.translate(c.width, 0); x.scale(-1, 1); }
  x.drawImage(v, 0, 0);
  c.toBlob(b => openEditor(b), 'image/jpeg', 0.92);
}
async function openEditor(blob) {
  stopCamera();
  const url = URL.createObjectURL(blob);
  const img = new Image(); img.src = url;
  try { await img.decode(); } catch (e) { toast('Das Bild konnte nicht gelesen werden.'); return; }
  await spotFonts();
  const at = new Date(), ctx = spotContext(at);
  SPOT.ed = { img, url, at, ctx, filter: 1, text: '', textY: 0.36, textSize: 0.052, dark: false, bar: true, seal: { x: 0.06, y: 0.70, w: ctx.tone ? 0.42 : 0.34 }, editing: false };
  location.hash = '#spot';
}
function viewCamera() {
  const last = SPOT.gallery.slice(-3), op = [0.35, 0.65, 1].slice(3 - last.length);
  const thumbs = last.map((g, i) => `<div class="cam-thw"><a class="cam-th" href="#spot-bild:${encodeURIComponent(g.id)}"><img src="${spotUrl(g)}" alt="Spot vom ${fmtDate(g.created)}" style="opacity:${op[i]}">${others().some(o => spotSeenBy(g.id, o)) ? `<span class="seen" aria-label="gesehen">${ICON.eye}</span>` : ''}</a><button class="cam-x" data-act="cam-del" data-id="${esc(g.id)}" aria-label="Spot vom ${fmtDate(g.created)} löschen"><i>${ICON.x}</i></button></div>`).join('');
  return `<div class="cam">
    <video id="cam-v" playsinline autoplay muted></video>
    ${last.length ? `<div class="cam-last"><span class="eyebrow">Letzte Spots</span><div class="cam-ths">${thumbs}</div></div>` : ''}
    <div class="cam-fb" id="cam-fb" hidden><span class="muted">Kein Live-Bild verfügbar.</span><label class="btn primary">Kamera öffnen<input type="file" id="sp-file2" accept="image/*" capture="environment" hidden></label></div>

    <div class="cam-ctl">
      <label class="tool big" aria-label="Aus Mediathek wählen">${ICON.img}<input type="file" id="sp-file" accept="image/*" hidden></label>
      <button class="shutter" data-act="sp-shoot" aria-label="Foto aufnehmen"><i></i></button>
      <button class="tool big" data-act="sp-flip" aria-label="Kamera drehen">${ICON.flip}</button>
    </div>
  </div>`;
}

/* ---------- Editor ---------- */
function viewEditor() {
  const e = SPOT.ed;
  return `<div class="sp-stage" id="sp-stage">
    <img class="sp-photo" src="${e.url}" alt="">
    <div class="sp-text ${e.dark ? 'dark' : ''} ${e.bar ? '' : 'nobar'}" id="sp-text" ${e.text || e.editing ? '' : 'hidden'} contenteditable="${e.editing ? 'plaintext-only' : 'false'}" spellcheck="false"></div>
    <div class="sp-fl" id="sp-fl"><div class="sp-seal" id="sp-seal"></div></div>
    <div class="sp-top">
      <button class="tool" data-act="sp-cancel" aria-label="Verwerfen">${ICON.x}</button>
      <div class="sp-tools">
        <button class="tool" data-act="sp-text" aria-label="Text">Aa</button>
        <button class="tool" data-act="sp-dark" aria-label="Schrift ${e.dark ? 'schwarz' : 'weiß'}"><span class="half ${e.dark ? 'inv' : ''}"></span></button>
        <button class="tool ${e.bar ? '' : 'off'}" data-act="sp-bar" aria-label="Balken hinter dem Text ${e.bar ? 'an' : 'aus'}">${ICON.barT}</button>
      </div>
    </div>
    <input type="range" class="sp-size" id="sp-size" min="0.03" max="0.11" step="0.002" value="${e.textSize}" aria-label="Textgröße" ${e.text || e.editing ? '' : 'hidden'}>
    <div class="sp-dots"><i class="${e.filter === 0 ? 'on' : ''}"></i><i class="${e.filter === 1 ? 'on' : ''}"></i></div>
    <div class="sp-send"><button class="btn primary" data-act="sp-send" id="sp-send-b">${others().length === 1 ? `Senden an ${nm(others()[0])}` : others().length ? 'An deine Buddys senden' : 'Speichern'} ${ICON.right}</button></div>
  </div>`;
}
function layoutEditor() {
  const e = SPOT.ed, stage = $('#sp-stage'); if (!e || !stage) return;
  const W = stage.clientWidth, H = stage.clientHeight;
  const t = $('#sp-text');
  t.style.top = (e.textY * H) + 'px'; t.style.fontSize = (e.textSize * W) + 'px';
  if (!e.editing && t.textContent !== e.text) t.textContent = e.text;
  const s = $('#sp-seal');
  if (!s.firstChild || s.dataset.dark !== String(e.dark)) { s.innerHTML = sealSVG(sealLayout(e.ctx, e.dark)); s.dataset.dark = String(e.dark); }
  s.style.left = (e.seal.x * W) + 'px'; s.style.top = (e.seal.y * H) + 'px'; s.style.width = (e.seal.w * W) + 'px';
  $('#sp-fl').style.transform = e.filter === 1 ? 'translateX(0)' : 'translateX(100%)';
}
function editText() {
  const e = SPOT.ed; e.editing = true;
  const t = $('#sp-text'); t.hidden = false; t.setAttribute('contenteditable', 'plaintext-only');
  if (t.contentEditable !== 'plaintext-only') t.setAttribute('contenteditable', 'true');
  $('#sp-size').hidden = false;
  t.focus();
  const r = document.createRange(); r.selectNodeContents(t); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
}
function endText() {
  const e = SPOT.ed; if (!e || !e.editing) return;
  const t = $('#sp-text'); e.text = t.innerText.replace(/\n{3,}/g, '\n\n').trim().slice(0, 240); e.editing = false;
  t.setAttribute('contenteditable', 'false'); t.textContent = e.text; t.hidden = !e.text; $('#sp-size').hidden = !e.text;
}
/* Gesten: Siegel ziehen/skalieren, Text senkrecht ziehen/skalieren, sonst waagerecht wischen = Filter */
const gest = { pts: new Map(), mode: null, start: null };
function edPointerDown(ev) {
  const e = SPOT.ed; if (!e) return;
  if (ev.target.closest('.sp-top, .sp-send, .sp-size') || (e.editing && ev.target.closest('#sp-text'))) return;
  gest.pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  const stage = $('#sp-stage'), W = stage.clientWidth, H = stage.clientHeight;
  if (gest.pts.size === 1) {
    const onSeal = e.filter === 1 && ev.target.closest('#sp-seal'), onText = ev.target.closest('#sp-text');
    gest.mode = onSeal ? 'seal' : onText ? 'text' : 'swipe';
    gest.start = { x: ev.clientX, y: ev.clientY, seal: { ...e.seal }, textY: e.textY, textSize: e.textSize, W, H, t: Date.now() };
  } else if (gest.pts.size === 2) {
    const [a, b] = [...gest.pts.values()];
    gest.mode = gest.mode === 'text' ? 'textpinch' : 'pinch';
    gest.start = { ...gest.start, d: Math.hypot(a.x - b.x, a.y - b.y), seal: { ...e.seal }, textSize: e.textSize };
  }
  try { ev.target.setPointerCapture && $('#sp-stage').setPointerCapture(ev.pointerId); } catch (x) { /* egal */ }
}
function edPointerMove(ev) {
  const e = SPOT.ed; if (!e || !gest.pts.has(ev.pointerId)) return;
  gest.pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  const g = gest.start; if (!g) return;
  if (gest.mode === 'seal') {
    e.seal.x = Math.min(0.95, Math.max(-0.3, g.seal.x + (ev.clientX - g.x) / g.W));
    e.seal.y = Math.min(0.95, Math.max(0, g.seal.y + (ev.clientY - g.y) / g.H));
    layoutEditor();
  } else if (gest.mode === 'text') {
    e.textY = Math.min(0.9, Math.max(0.04, g.textY + (ev.clientY - g.y) / g.H)); layoutEditor();
  } else if ((gest.mode === 'pinch' || gest.mode === 'textpinch') && gest.pts.size >= 2) {
    const [a, b] = [...gest.pts.values()], f = Math.hypot(a.x - b.x, a.y - b.y) / (g.d || 1);
    if (gest.mode === 'textpinch') { e.textSize = Math.min(0.11, Math.max(0.03, g.textSize * f)); $('#sp-size').value = e.textSize; }
    else if (e.filter === 1) { const w = Math.min(0.95, Math.max(0.15, g.seal.w * f)); e.seal.x = g.seal.x - (w - g.seal.w) / 2; e.seal.w = w; }
    layoutEditor();
  } else if (gest.mode === 'swipe') {
    const dx = ev.clientX - g.x;
    if (Math.abs(dx) > 8) { const base = e.filter === 1 ? 0 : g.W; $('#sp-fl').style.transition = 'none'; $('#sp-fl').style.transform = `translateX(${Math.min(g.W, Math.max(0, base + dx))}px)`; }
  }
}
function edPointerUp(ev) {
  const e = SPOT.ed; if (!e || !gest.pts.has(ev.pointerId)) return;
  gest.pts.delete(ev.pointerId);
  const g = gest.start;
  if (gest.mode === 'swipe' && g && gest.pts.size === 0) {
    const dx = ev.clientX - g.x, dy = ev.clientY - g.y;
    $('#sp-fl').style.transition = '';
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) e.filter = dx < 0 ? 1 : 0;
    else if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && Date.now() - g.t < 400) { if (e.editing) endText(); else editText(); }
    layoutEditor();
    document.querySelectorAll('.sp-dots i').forEach((d, i) => d.classList.toggle('on', i === e.filter));
  } else if (gest.mode === 'text' && g && gest.pts.size === 0 && Math.abs(ev.clientY - g.y) < 8 && Date.now() - g.t < 400) editText();
  if (gest.pts.size === 0) { gest.mode = null; gest.start = null; }
}
async function renderSpot() {
  const e = SPOT.ed, stage = $('#sp-stage'), sw = stage.clientWidth, sh = stage.clientHeight;
  const W = 1080, H = Math.min(2400, Math.round(W * sh / sw)), f = W / sw;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const iw = e.img.naturalWidth, ih = e.img.naturalHeight, sc = Math.max(W / iw, H / ih);
  x.drawImage(e.img, (W - iw * sc) / 2, (H - ih * sc) / 2, iw * sc, ih * sc);
  if (e.text) {
    const fs = e.textSize * sw * f, padX = 18 * f, padY = 8 * f, lh = fs * 1.35, maxW = W - 2 * padX;
    x.font = `500 ${fs}px "Geist Mono"`;
    const lines = [];
    e.text.split('\n').forEach(par => {
      let cur = '';
      par.split(/\s+/).forEach(word => {
        const t = cur ? cur + ' ' + word : word;
        if (x.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = word; }
      });
      lines.push(cur);
    });
    const y0 = e.textY * sh * f, boxH = lines.length * lh + 2 * padY;
    if (e.bar) { x.fillStyle = e.dark ? 'rgba(255,255,255,.62)' : 'rgba(0,0,0,.5)'; x.fillRect(0, y0, W, boxH); }
    x.save();
    if (!e.bar) { x.shadowColor = e.dark ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.75)'; x.shadowBlur = 6 * f; x.shadowOffsetY = f; }
    x.fillStyle = e.dark ? '#000' : '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    lines.forEach((l, i) => x.fillText(l, W / 2, y0 + padY + lh * (i + 0.5)));
    x.restore();
  }
  if (e.filter === 1) { const L = sealLayout(e.ctx, e.dark); drawSeal(x, L, e.seal.x * W, e.seal.y * sh * f, e.seal.w * W / L.W); }
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
}
async function sendSpot() {
  const e = SPOT.ed; if (!e) return;
  endText();
  const b = $('#sp-send-b'); if (b) { b.disabled = true; b.textContent = 'Sende …'; }
  try {
    const blob = await renderSpot();
    const rec = { id: uid(), person: cfg.me, created: e.at.toISOString(), meta: { kind: e.filter === 1 ? e.ctx.kind : 'none', day: e.ctx.day || null }, img: await blob.arrayBuffer(), shared: false, up: false };
    await SDB.put('gallery', rec);
    closeEditor(); await loadSpots();
    toast(others().length ? `Spot an ${others().length === 1 ? pname(others()[0]) : 'deine Buddys'} gesendet` : 'Spot gespeichert. Sobald du Buddys hast, sehen sie deine Spots.');
    location.hash = '#kamera';
    spotSync().then(() => gallerySync());
  } catch (err) { if (b) { b.disabled = false; b.textContent = 'Senden'; } toast('Spot konnte nicht erstellt werden.'); }
}
function closeEditor() { if (SPOT.ed) URL.revokeObjectURL(SPOT.ed.url); SPOT.ed = null; }

/* ---------- Ansehen ---------- */
function openViewer() {
  const list = unseenSpots(); if (!list.length) { location.hash = '#start'; return; }
  SPOT.view = { list, i: 0, t0: 0, el: 0, paused: false, raf: 0, down: null };
  location.hash = '#spots';
}
function viewViewer() {
  const v = SPOT.view, s = v.list[v.i];
  return `<div class="sv" id="sv">
    <img class="sv-img" src="${spotUrl(s)}" alt="Spot von ${nm(s.person)}">
    <div class="sv-bars">${v.list.map((x, i) => `<i><b style="width:${i < v.i ? 100 : 0}%" ${i === v.i ? 'id="sv-cur"' : ''}></b></i>`).join('')}</div>
    <div class="sv-head"><a href="#profil:${esc(s.person)}" data-act="sv-prof" aria-label="Profil von ${nm(s.person)}">${avatar(s.person, 34)}</a><span style="flex:1;display:flex;flex-direction:column;line-height:1.2"><a href="#profil:${esc(s.person)}" data-act="sv-prof" style="font-weight:700;color:#fff;text-decoration:none;align-self:flex-start">${nm(s.person)}</a><span class="mono small" style="opacity:.8">${relDay(s.created)}, ${fmtTime(s.created)}</span></span><button class="tool" data-act="sv-close" aria-label="Schließen">${ICON.x}</button></div>
    <div class="sv-bot" id="sv-bot">
      <div class="sv-emo glass">${SPOT_EMOJI.map(m => `<button type="button" data-act="sv-react" data-v="${m}" aria-label="Reagieren mit ${m}" ${st().spotMyReact[s.id] === m ? 'class="on"' : ''}>${m}</button>`).join('')}<i aria-hidden="true"></i><button type="button" class="sv-more ${st().spotMyReact[s.id] && !SPOT_EMOJI.includes(st().spotMyReact[s.id]) ? 'on' : ''}" data-act="sv-compose" data-v="emoji" aria-label="Mit einem anderen Emoji reagieren">${st().spotMyReact[s.id] && !SPOT_EMOJI.includes(st().spotMyReact[s.id]) ? `<span class="emo1">${esc(st().spotMyReact[s.id])}</span>` : ICON.emoplus}</button></div>
      <span style="flex:1"></span>
      <button type="button" class="sv-reply glass" data-act="sv-compose" data-v="text" aria-label="Antwort an ${nm(s.person)} schreiben">${ICON.chat.replace('width="20" height="20"', 'width="22" height="22"')}</button>
    </div>
    <form class="sv-compose" id="sv-compose" hidden novalidate>
      <span class="small" id="sv-c-hint"></span>
      <div class="sv-c-row"><button type="button" class="sv-c-x" data-act="sv-c-x" aria-label="Abbrechen">${ICON.x}</button><textarea class="sv-c-in" id="sv-in" rows="1" autocomplete="off"></textarea><button class="sv-c-send" type="submit" aria-label="Senden">${ICON.send}</button></div>
    </form>
  </div>`;
}
function viewerShow() {
  const v = SPOT.view; if (!v) return;
  const s = v.list[v.i];
  if (!spotSeenBy(s.id, cfg.me) && !v.list[v.i]._seen) { v.list[v.i]._seen = true; addEvent('spot_seen', { spot: s.id, owner: s.person }, `Spot von ${s.person} gesehen`); }
  v.el = 0; v.t0 = performance.now();
  cancelAnimationFrame(v.raf);
  const tick = now => {
    if (!SPOT.view || view !== 'spots') return;
    if (!v.paused) { v.el += now - v.t0; }
    v.t0 = now;
    const b = $('#sv-cur'); if (b) b.style.width = Math.min(100, v.el / SPOT_SHOW * 100) + '%';
    if (v.el >= SPOT_SHOW) { viewerNext(); return; }
    v.raf = requestAnimationFrame(tick);
  };
  v.raf = requestAnimationFrame(tick);
}
function viewerNext() {
  const v = SPOT.view; if (!v) return;
  if (v.i >= v.list.length - 1) { closeViewer(); return; }
  v.i++; render();
}
function closeViewer() {
  const v = SPOT.view; if (v) cancelAnimationFrame(v.raf);
  SPOT.view = null; location.hash = (v && v.back) || '#start';
  loadSpots().then(() => { if (view === 'start') safeRender(); });
}
// Antwort oder anderes Emoji eingeben: Spot pausiert, Eingabe sitzt über der Tastatur
function svCompose(mode) {
  const v = SPOT.view; if (!v) return; const s = v.list[v.i];
  const f = $('#sv-compose'), inp = $('#sv-in'); if (!f || !inp) return;
  v.paused = true; v.compose = mode;
  f.hidden = false; $('#sv-bot').hidden = true;
  inp.value = ''; inp.maxLength = mode === 'emoji' ? 16 : 1000; inp.style.height = '';
  inp.setAttribute('enterkeyhint', mode === 'emoji' ? 'send' : 'enter');
  inp.placeholder = mode === 'emoji' ? 'Emoji' : `Antwort an ${s.person}`;
  inp.setAttribute('aria-label', mode === 'emoji' ? 'Emoji als Reaktion' : `Antwort an ${s.person}`);
  inp.classList.toggle('emo', mode === 'emoji');
  $('#sv-c-hint').textContent = mode === 'emoji' ? 'Tippe ein Emoji, auf der Tastatur über 😀 oder 🌐.' : `Antwort an ${s.person} · landet im Chat mit dem Spot`;
  inp.focus();
}
function svComposeEnd() {
  const v = SPOT.view; if (!v) return;
  v.compose = null; v.paused = false;
  const f = $('#sv-compose'); if (f) f.hidden = true; const b = $('#sv-bot'); if (b) b.hidden = false;
  const i = $('#sv-in'); if (i) i.blur();
}
function svSubmit() {
  const v = SPOT.view; if (!v || !v.compose) return; const s = v.list[v.i];
  const val = ($('#sv-in').value || '').trim(); if (!val) { svComposeEnd(); return; }
  if (v.compose === 'emoji') {
    const segs = typeof Intl !== 'undefined' && Intl.Segmenter ? [...new Intl.Segmenter('de', { granularity: 'grapheme' }).segment(val)].map(x => x.segment) : [val];
    const em = segs.find(isEmoji);
    if (!em) { toast('Bitte ein Emoji eingeben'); return; }
    spotReact(s, em);
  } else {
    chatSend(s.person, val, { spot: s.id, spotOwner: s.person });
    toast(`Antwort an ${s.person} geschickt`);
  }
  svComposeEnd();
}
function spotReact(s, em) {
  const cur = st().spotMyReact[s.id];
  const next = cur === em ? '' : em;
  addEvent('spot_react', { spot: s.id, owner: s.person, emoji: next }, next ? `Reaktion ${next} auf Spot von ${s.person}` : `Reaktion auf Spot von ${s.person} zurückgenommen`);
  document.querySelectorAll('.sv-emo button[data-act="sv-react"]').forEach(b => b.classList.toggle('on', !!next && b.dataset.v === next));
  const more = $('.sv-more'); if (more) { const custom = next && !SPOT_EMOJI.includes(next); more.classList.toggle('on', !!custom); more.innerHTML = custom ? `<span class="emo1">${esc(next)}</span>` : ICON.emoplus; }
  toast(next ? `${next} an ${s.person} geschickt` : 'Reaktion zurückgenommen');
}
function svDown(ev) {
  const v = SPOT.view; if (!v) return;
  // beim Schreiben: Tippen aufs Bild schließt nur die Tastatur, der Text bleibt (Abbrechen über ×)
  if (v.compose) { if (!ev.target.closest('.sv-compose')) { const i = $('#sv-in'); if (i) i.blur(); } return; }
  if (ev.target.closest('.sv-bot, .sv-head, .sv-compose')) return;
  v.down = { x: ev.clientX, y: ev.clientY, t: Date.now() };
  v.holdT = setTimeout(() => { if (v.down) v.paused = true; }, 220);
}
function svUp(ev) {
  const v = SPOT.view; if (!v || !v.down) return;
  clearTimeout(v.holdT);
  const d = v.down; v.down = null;
  const dy = ev.clientY - d.y, dx = ev.clientX - d.x;
  if (dy > 80 && Math.abs(dy) > Math.abs(dx)) { closeViewer(); return; }
  if (v.paused) { v.paused = false; return; }
  if (Date.now() - d.t < 300 && Math.abs(dx) < 12 && Math.abs(dy) < 12) viewerNext();
}

/* ---------- Galerie ---------- */
function galleryHTML() {
  const g = SPOT.gallery.slice().reverse();
  const saved = LS.get('gal.key.' + cfg.me, null);
  return `<div class="sec-title"><h2>Meine Spots</h2><span class="mono muted small">${g.length} ${g.length === 1 ? 'Spot' : 'Spots'}</span></div>
    ${g.length ? `<div class="sgrid">${g.map(x => `<a href="#spot-bild:${encodeURIComponent(x.id)}"><img src="${spotUrl(x)}" alt="Spot vom ${fmtDate(x.created)}" loading="lazy">${reactBadges(x.id)}</a>`).join('')}</div>` : `<section class="card"><div class="empty">Noch keine Spots. Über die Kamera ganz links in der Leiste machst du deinen ersten.</div></section>`}
    <span class="small muted">${saved ? 'Nur deine eigenen Spots. Gesichert mit deinem Vault-Schlüssel, nach einem Handywechsel kommen sie mit zurück.' : 'Nur deine eigenen Spots. Öffne einmal den Vault, dann werden sie mitgesichert.'}</span>`;
}
function viewSpotImage(id) {
  const g = SPOT.gallery.find(x => x.id === id);
  if (!g) return `<div class="sv"><div class="sv-head"><a class="tool" href="#profil">${ICON.left}</a></div><div class="empty" style="margin-top:120px">Spot nicht gefunden.</div></div>`;
  return `<div class="sv">
    <img class="sv-img" src="${spotUrl(g)}" alt="Spot vom ${fmtDate(g.created)}">
    <div class="sv-head" style="top:calc(var(--sat) + 14px)"><a class="tool" href="${SPOT.back || '#profil'}" aria-label="Zurück">${ICON.left}</a><span style="flex:1;text-align:center"><span class="mono small sv-chip">${fmtDate(g.created)} · ${fmtTime(g.created)}</span></span><span style="width:44px"></span></div>
    ${SPOT.galDel === id ? '' : `<div class="sv-reacts" aria-label="Reaktionen">${spotReactions(id).map(reactBubble).join('')}</div>`}
    <div class="sv-act">${SPOT.galDel === id
      ? `<div class="confirm glass" style="width:100%"><b>Spot löschen?</b><span class="small muted">Er verschwindet aus deiner Galerie${Date.now() - new Date(g.created) < SPOT_MAX ? ' und, falls noch sichtbar, bei deinen Buddys' : ''}.</span><div class="btnrow"><button class="btn small danger" data-act="sg-del-yes" data-id="${esc(id)}">Löschen</button><button class="btn small ghost" data-act="sg-del-no">Abbrechen</button></div></div>`
      : `<button class="btn primary" data-act="sg-save" data-id="${esc(id)}" style="flex:1">${ICON.dl} In Fotos sichern</button><button class="btn danger" data-act="sg-del" data-id="${esc(id)}" style="width:50px;padding:0" aria-label="Löschen">${ICON.x}</button>`}</div>
  </div>`;
}
async function saveSpotToPhotos(id, withReacts) {
  const g = SPOT.gallery.find(x => x.id === id); if (!g) return;
  const name = `spot-${dateKey(g.created)}-${fmtTime(g.created).replace(':', '')}${withReacts ? '-reaktionen' : ''}.jpg`;
  let data = g.img;
  if (withReacts) { try { data = await spotWithReactions(g); } catch (e) { toast('Reaktionen ließen sich nicht einzeichnen, sichere nur das Foto'); data = g.img; } }
  const file = new File([data], name, { type: 'image/jpeg' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = data === g.img ? spotUrl(g) : URL.createObjectURL(data); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
async function deleteSpot(id, back = '#profil') {
  const g = SPOT.gallery.find(x => x.id === id); if (!g) return;
  await SDB.del('gallery', id);
  if (g.shared) { const t = LS.get('spot.tomb.' + cfg.me, []); t.push(id); LS.set('spot.tomb.' + cfg.me, t); }
  if (g.up) { const t = LS.get('gal.tomb.' + cfg.me, []); t.push(id); LS.set('gal.tomb.' + cfg.me, t); }
  if (SPOT.urls[id]) { URL.revokeObjectURL(SPOT.urls[id]); delete SPOT.urls[id]; }
  await loadSpots(); SPOT.galDel = null; toast('Spot gelöscht'); if (location.hash !== back) location.hash = back; else render();
  spotSync(); gallerySync();
}

/* ---------- Oberfläche ---------- */
let otherDayAsk = false;
let view = '', verlaufTab = 'aktiv', notesFilter = 'Alle', builder = null, resetAsk = false, logoutAsk = false, pendingRender = false;
const cal = { y: new Date().getFullYear(), m: new Date().getMonth(), sel: todayStr() };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2800);
}
function bellBtn(id = 'bell') {
  const n = openCount();
  return `<a class="iconbtn" id="${id}" href="#glocke" aria-label="Planänderungen${n ? ', ' + n + ' neu' : ''}">${ICON.bell}${n ? `<span class="badge">${n}</span>` : ''}</a>`;
}
const gearBtn = () => `<a class="iconbtn" href="#einstellungen" aria-label="Einstellungen">${ICON.gear}</a>`;
const backBtn = (to, label = 'Zurück') => `<a class="iconbtn" href="#${to}" aria-label="${label}">${ICON.left}</a>`;
function head(title, big = true) { return `<header class="head" id="head"><div class="brand ${big ? 'big' : ''}">${title}</div>${chatBtn()}${bellBtn()}</header>`; }
const subhead = (backTo = 'start', right = '') => `<header class="head" id="head">${backBtn(backTo)}<div class="brand"></div>${right}</header>`;
function tabbar(active) {
  const t = (id, label, icon) => `<a href="#${id}" ${active === id ? 'aria-current="page"' : ''}>${icon}<span>${label}</span></a>`;
  return `<nav class="tabbar glass" aria-label="Navigation">${t('kamera', 'Kamera', ICON.cam)}${t('start', 'Start', ICON.home)}${t('verlauf', 'Verlauf', ICON.chart)}${t('plan', 'Plan', ICON.list)}${t('buddies', 'Buddies', ICON.users + (socialCount() ? `<span class="badge">${socialCount()}</span>` : ''))}${t('profil', 'Profil', avatar(cfg.me, 24))}</nav>`;
}

function safeRender() {
  const a = document.activeElement;
  if (a && $('#app').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { pendingRender = true; if (view === 'training') refreshTraining(); return; }
  if (view === 'training' && draft) { refreshTraining(); return; }
  if (view.startsWith('vault')) return; // Vault nicht durch Sync neu zeichnen
  if (['spot', 'spots', 'kamera', 'spot-bild'].includes(view)) return; // Kamera, Editor und Ansehen nicht unterbrechen
  render();
}
document.addEventListener('focusout', () => setTimeout(() => {
  if (!pendingRender) return;
  const a = document.activeElement;
  if (a && $('#app').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  pendingRender = false; if (view === 'training' && draft) refreshTraining(); else if (!view.startsWith('vault')) render();
}, 50));

function exerciseDay(id, k = curPlan()) { const p = planOf(cfg.me, k); return PD(p).find(d => p[d].exercises.some(x => x.id === id)) || null; }

/* ---------- Hintergrund: Noise-Verlauf (Mechanik wie die Blender-Nodes) ----------
   Wolken = grobes Gradient-Rauschen, Grain = feines Pixel-Rauschen, gemischt und über eine Rampe
   von Schwarz zur Tagesfarbe eingefärbt. Das Muster hängt nur von der Position ab: Wird die Seite länger,
   werden unten einfach neue Abschnitte (je 512 px) dazugerechnet, die nahtlos anschließen. Bestehende bleiben. */
const BG = (() => {
  const CHUNK = 512;
  const TONES = {
    '': { rgb: [255, 255, 255], str: .3, lo: .56, seed: 5 },
    y: { rgb: [255, 242, 0], str: .68, lo: .56, seed: 11 },
    m: { rgb: [236, 0, 140], str: .8, lo: .56, seed: 23 },
    c: { rgb: [0, 174, 239], str: .8, lo: .56, seed: 37 }
  };
  const GAIN = 4.5, GRAIN = .29, CX = .003, CY = .0024;
  function makeNoise(seed) {
    let s = seed >>> 0 || 1;
    const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 >>> 0) / 4294967296);
    const p = new Uint8Array(512), gx = new Float32Array(256), gy = new Float32Array(256), base = [...Array(256).keys()];
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [base[i], base[j]] = [base[j], base[i]]; }
    for (let i = 0; i < 512; i++) p[i] = base[i & 255];
    for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const perlin = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
      const k00 = p[p[X] + Y], k10 = p[p[X + 1] + Y], k01 = p[p[X] + Y + 1], k11 = p[p[X + 1] + Y + 1];
      const n00 = gx[k00] * xf + gy[k00] * yf, n10 = gx[k10] * (xf - 1) + gy[k10] * yf;
      const n01 = gx[k01] * xf + gy[k01] * (yf - 1), n11 = gx[k11] * (xf - 1) + gy[k11] * (yf - 1);
      const u = fade(xf), v = fade(yf), a = n00 + u * (n10 - n00), b = n01 + u * (n11 - n01);
      return a + v * (b - a);
    };
    // zwei Ebenen, auf die Werteverteilung des Entwurfs normiert
    return (x, y) => .553 + (perlin(x, y) + .5 * perlin(x * 2 + 17.3, y * 2 + 5.1) + .037) * .4225;
  }
  const hash = (x, y, seed) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519 | 0); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const sets = {};   // je Farbton: { width, noise, canvases[] }
  let el = null, tone = null, height = 0, queue = false;
  function draw(t, i) {
    const S = sets[t], cfg = TONES[t], w = S.width, cv = document.createElement('canvas');
    cv.width = w; cv.height = CHUNK; cv.style.top = (i * CHUNK) + 'px';
    const ctx = cv.getContext('2d'), img = ctx.createImageData(w, CHUNK), d = img.data;
    const cr = cfg.rgb[0] * cfg.str, cg = cfg.rgb[1] * cfg.str, cb = cfg.rgb[2] * cfg.str, y0 = i * CHUNK;
    for (let y = 0; y < CHUNK; y++) for (let x = 0; x < w; x++) {
      const v = S.noise(x * CX, (y0 + y) * CY) + GRAIN * (hash(x, y0 + y, cfg.seed) - .5);
      let k = (v - cfg.lo) * GAIN; k = k < 0 ? 0 : k > 1 ? 1 : k;
      const o = (y * w + x) * 4; d[o] = cr * k; d[o + 1] = cg * k; d[o + 2] = cb * k; d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    S.canvases[i] = cv;
  }
  function fill() {
    queue = false;
    if (!el) return;
    const w = Math.max(1, Math.round(el.clientWidth));
    let S = sets[tone];
    if (!S || S.width !== w) S = sets[tone] = { width: w, noise: makeNoise(TONES[tone].seed), canvases: [] };
    const need = Math.ceil(height / CHUNK);
    // zuerst der sichtbare Bereich, dann der Rest, ein Abschnitt pro Bild, damit nichts ruckelt
    const app = $('#app'), first = Math.floor((app ? app.scrollTop : 0) / CHUNK);
    const order = [...Array(need).keys()].sort((a, b) => Math.abs(a - first) - Math.abs(b - first));
    const todo = order.find(i => !S.canvases[i]);
    if (todo !== undefined) { draw(tone, todo); queue = true; requestAnimationFrame(fill); }
    const want = S.canvases.slice(0, need).filter(Boolean);
    if (el.childElementCount !== want.length || [...el.children].some((c, i) => c !== want[i])) el.replaceChildren(...want);
    el.style.height = height + 'px';
  }
  function update(nextTone, nextHeight) {
    return; // Noise-Hintergrund aus
    el = el || $('#bg');
    tone = TONES[nextTone] ? nextTone : '';
    height = Math.ceil(nextHeight);
    if (!queue) { queue = true; requestAnimationFrame(fill); }
  }
  return { update, reset() { for (const k in sets) delete sets[k]; if (el) el.replaceChildren(); update(tone || '', height); } };
})();

/* #app enthält dauerhaft den Hintergrund (#bg) und die Seite (#page). Nur die Seite wird neu gezeichnet,
   der Hintergrund bleibt stehen und wächst mit der Seitenhöhe mit. */
let pageObserver = null;
function setPage(html, tone) {
  const app = $('#app');
  let bg = $('#bg'), page = $('#page');
  if (!bg || !page) {
    app.innerHTML = '<div id="bg" aria-hidden="true"></div><div id="page" class="page"></div>';
    bg = $('#bg'); page = $('#page');
    if ('ResizeObserver' in window) { pageObserver = new ResizeObserver(() => BG.update(document.body.dataset.tone || '', page.offsetHeight)); pageObserver.observe(page); }
  }
  page.innerHTML = html;
  BG.update(tone, page.offsetHeight);
}
function render() {
  const app = $('#app');
  if (!cfg.me) { document.body.dataset.tone = ''; setPage(viewSetup(), ''); return; }
  const h = decodeURIComponent(location.hash.slice(1)) || 'start';
  const [name, arg] = h.includes(':') ? [h.slice(0, h.indexOf(':')), h.slice(h.indexOf(':') + 1)] : [h, ''];
  if (name !== view) {
    resetAsk = logoutAsk = otherDayAsk = false; if (view.startsWith('vault') && !name.startsWith('vault')) lockVault();
    if (view === 'kamera') stopCamera();
    if (view === 'privatsphaere' && PZS && PZS.reopen) { PZS.reopen = false; if (name === 'start') setTimeout(pauseSheet, 60); else PZS = null; }
    if (view === 'scanner') stopScan();
    if (name === 'crew') CREWV = { edit: false, invite: false, leave: false, rm: null, name: '' };
    if (view === 'spot' && name !== 'spot') closeEditor();
    if (view === 'spots' && name !== 'spots' && SPOT.view) { cancelAnimationFrame(SPOT.view.raf); SPOT.view = null; }
    if (view === 'spot-bild') SPOT.galDel = null;
    if (name === 'spot-bild') SPOT.back = view === 'chat' && CHAT.open ? '#chat:' + encodeURIComponent(CHAT.open) : view === 'start' || view === 'verlauf' ? '#' + view : '#profil';
    if (view === 'chat') { CHAT.open = null; CHAT.reply = null; }
    if (name === 'notizen') { const ex = arg.split(':')[1]; NOTE_FOCUS = ex ? { ex, from: view, t: Date.now(), dim: true } : null; }
  }
  let html, tone = '';
  switch (name) {
    case 'training': if (!draft) { location.hash = '#start'; return; } html = viewTraining(); tone = DAY_TONE[draft.day]; break;
    case 'bearbeiten': if (!edraft) { location.hash = '#verlauf'; return; } html = withEd(viewEdit); tone = DAY_TONE[edraft.day]; break;
    case 'verlauf': html = head('Verlauf') + `<main class="view">${viewVerlauf()}</main>` + tabbar('verlauf'); break;
    case 'plan': html = head('Plan') + `<main class="view">${viewPlan()}</main>` + tabbar('plan'); tone = pkind() === 'crew' && !hasCrew() ? '' : DAY_TONE[builder.day] || ''; break;
    case 'privatsphaere': html = subhead(PZS && PZS.reopen ? 'start' : 'einstellungen') + `<main class="view nobar">${viewPrivacy()}</main>`; break;
    case 'daten': html = subhead('einstellungen') + `<main class="view nobar">${viewData()}</main>`; break;
    case 'feedback': html = subhead('einstellungen') + `<main class="view nobar">${viewFeedback()}</main>`; break;
    case 'buddies': html = head('Buddies') + `<main class="view">${viewBuddies()}</main>` + tabbar('buddies'); break;
    case 'crew': html = subhead('buddies') + `<main class="view">${viewCrew()}</main>` + tabbar('buddies'); break;
    case 'scanner': html = viewScanner(); break;
    case 'bibliothek': html = subhead('plan') + `<main class="view">${viewLibrary()}</main>` + tabbar('plan'); break;
    case 'notizen': {
      const fromTr = NOTE_FOCUS && NOTE_FOCUS.from === 'training' && draft;
      html = `<header class="head" id="head">${fromTr ? backBtn('training', 'Zurück zum Training') : backBtn('plan')}<div class="brand"></div></header><main class="view">${viewNotes3(arg)}</main>` + (fromTr ? '' : tabbar('plan')); tone = 'y'; break;
    }
    case 'glocke': html = subhead(draft ? 'training' : 'start') + `<main class="view">${viewBell()}</main>` + (draft ? '' : tabbar('')); break;
    case 'einstellungen': html = subhead(draft ? 'training' : 'start') + `<main class="view nobar">${viewSettings()}</main>`; break;
    case 'ueber': html = subhead('einstellungen') + `<main class="view nobar">${viewAbout()}</main>`; break;
    case 'rechtliches': html = subhead('ueber') + `<main class="view nobar legal">${viewLegal(arg)}</main>`; break;
    case 'gewicht': html = subhead('profil') + `<main class="view">${viewBodyweight()}</main>` + tabbar('profil'); break;
    case 'profil': html = (arg && arg !== cfg.me ? subhead('buddies', PEOPLE.includes(arg) ? `<button class="iconbtn" data-act="bud-menu" data-p="${esc(arg)}" aria-label="Mehr">${ICON.more}</button>` : '') : `<header class="head" id="head"><div class="brand"></div>${gearBtn()}</header>`) + `<main class="view">${viewProfile(arg && PEOPLE.includes(arg) ? arg : cfg.me)}</main>` + tabbar(arg && arg !== cfg.me ? '' : 'profil'); break;
    case 'vault': html = subhead('profil', VAULT.key && VAULT.mode === 'unlock' && !VAULT.showKey ? `<button class="btn small glass" data-act="v-lock" style="border-color:rgba(255,255,255,.3)">${ICON.lock.replace('width="22" height="22"', 'width="16" height="16"')} Sperren</button>` : '') + `<main class="view nobar">${viewVault()}</main>`; break;
    case 'vault-wiederherstellen': html = subhead(vmeta() ? 'einstellungen' : 'vault') + `<main class="view nobar">${viewRestore()}</main>`; break;
    case 'vault-neu': if (!VAULT.key) { location.hash = '#vault'; return; } html = subhead('vault') + `<main class="view nobar">${viewVaultNew()}</main>`; break;
    case 'uebung': html = subhead('verlauf') + `<main class="view">${viewExercise(arg)}</main>` + tabbar('verlauf'); tone = DAY_TONE[exerciseDay(arg)] || ''; break;
    case 'training-log': { html = subhead('verlauf') + `<main class="view">${viewWorkout(arg)}</main>` + tabbar('verlauf'); const w = st().workouts.find(x => x.id === arg); tone = w ? DAY_TONE[w.data.day] : ''; break; }
    case 'kamera': html = `<main class="view cam-view">${viewCamera()}</main>` + tabbar('kamera'); break;
    case 'spot': if (!SPOT.ed) { location.hash = '#kamera'; return; } html = viewEditor(); break;
    case 'spots': if (!SPOT.view) { openViewer(); return; } html = viewViewer(); break;
    case 'spot-bild': html = viewSpotImage(arg); break;
    case 'chats': html = subhead(draft ? 'training' : 'start') + `<main class="view">${viewChats()}</main>` + tabbar(''); break;
    case 'chat': if (!chatTargets().includes(arg)) { location.hash = '#chats'; return; } html = viewChat(arg); break;
    case 'geschafft': html = viewDone(arg); if (!html) { location.hash = '#start'; return; } break;
    default: html = `<header class="head" id="head"><div class="brand built">BUILT</div>${spotRing() || flameCap()}${chatBtn()}${bellBtn()}${gearBtn()}</header><main class="view">${viewStart()}</main>` + tabbar('start');
  }
  document.body.dataset.tone = tone;
  setPage(html, tone);
  if (name !== view) {
    app.scrollTop = 0; view = name;
    if (name === 'notizen' && NOTE_FOCUS) { const c = document.getElementById('nc-' + NOTE_FOCUS.ex); if (c) { c.scrollIntoView({ block: 'center' }); NOTE_FOCUS.t = Date.now(); } }
    if (name === 'scanner') startScan();
    trackView(name || 'start');
    if (name === 'vault' && !vmeta() && !VAULT.restore && !hasConsent('health')) { history.replaceState(null, '', '#profil'); render(); healthSheet(() => { location.hash = '#vault'; }); return; }
    if ((name === 'start' || name === '') && !draft && !LS.get('stats.asked', false) && CONSENTS.analytics === undefined && st().workouts.some(w => w.person === cfg.me && Date.now() - new Date(w.ts) < 864e5)) setTimeout(statsSheet, 600);
  }
  tabSlideIn();
  pendingRender = false;
  onScroll();
  if (name === 'vault') fillVaultImages();
  if (name === 'training' && TIMER) tmrTick();
  if (name === 'kamera') { const v = $('#cam-v'); if (SPOT.stream && v) { v.srcObject = SPOT.stream; v.classList.toggle('mirror', SPOT.facing === 'user'); v.play().catch(() => {}); } else startCamera(); }
  if (name === 'spot') layoutEditor();
  if (name === 'spots') viewerShow();
  if (name === 'chat') { chatMarkRead(arg); app.scrollTop = app.scrollHeight; }
  document.body.classList.toggle('fullbleed', ['kamera', 'spot', 'spots', 'spot-bild', 'geschafft'].includes(name));
}
// Spot-Symbol: Profilbild des Senders mit dem ältesten ungesehenen Spot, ab zwei Spots mit Zähler
function spotRing() {
  const u = unseenSpots(); if (!u.length) return '';
  const first = u[0], col = first.meta && first.meta.day ? TONE_HEX[DAY_TONE[first.meta.day]] : TONE_HEX.m;
  const who = [...new Set(u.map(x => x.person))];
  return `<button class="spotring" data-act="spot-open" style="--ring:${col}" aria-label="${u.length} ${u.length === 1 ? 'neuer Spot' : 'neue Spots'} von ${esc(who.join(' und '))}"><span class="ring-in">${avatar(first.person, 28)}</span>${u.length > 1 ? `<span class="badge">${u.length}</span>` : ''}</button>`;
}
// Ohne ungesehene Spots sitzt an derselben Stelle die Flammen-Kapsel: Wochenflamme und eigener Streak, führt zur Flammen-Liste
function flameCap() {
  const n = flameStats(cfg.me).streak;
  return `<button class="fcap glass" data-act="to-flames" aria-label="Dein Wochenstreak: ${n} ${n === 1 ? 'Woche' : 'Wochen'}. Zu den Flammen">${flameImg(cfg.me)}<b>${n}</b></button>`;
}
function onScroll() { const h = $('#head'); if (h) h.classList.toggle('scrolled', $('#app').scrollTop > 4); const sh = $('.sheet.full'); if (sh) sh.classList.toggle('scrolled', sh.scrollTop > 40); }
document.addEventListener('scroll', onScroll, { passive: true, capture: true });
/* Echte Bildschirmhöhe: Als App vom Home-Bildschirm meldet iOS teils eine zu kleine Höhe, dann entstünde unten ein Balken. */
function setHeight() {
  let h = window.innerHeight;
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (standalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) h = Math.max(h, matchMedia('(orientation: portrait)').matches ? screen.height : screen.width);
  document.documentElement.style.setProperty('--H', h + 'px');
}
setHeight();
window.addEventListener('resize', setHeight);
let bgW = innerWidth; window.addEventListener('resize', () => { if (innerWidth !== bgW) { bgW = innerWidth; BG.reset(); } });
window.addEventListener('orientationchange', () => setTimeout(setHeight, 300));

/* ---------- Start ---------- */
function syncLine() {
  const waiting = pending.filter(p => !seenIds.has(p.id)).length;
  if (!cfg.url) return `<div class="syncline"><i class="sdot off"></i><span>Ohne Sync – Einträge bleiben nur auf diesem Handy.</span><a class="linkbtn" href="#einstellungen">Einrichten</a></div>`;
  const old = scriptVersion != null && scriptVersion < SCRIPT_MIN;
  const txt = old ? 'Google-Skript bitte aktualisieren (siehe Anleitung)' :
    syncError && waiting ? `${waiting} ${waiting === 1 ? 'Eintrag wartet' : 'Einträge warten'} auf Sync` :
    waiting ? `${waiting} ${waiting === 1 ? 'Eintrag wird' : 'Einträge werden'} gesendet …` :
    lastSync ? `Synchronisiert ${relDay(lastSync)}, ${fmtTime(lastSync)}` : 'Noch nicht synchronisiert';
  return `<div class="syncline"><i class="sdot ${waiting || old ? 'wait' : ''}"></i><span>${txt}</span><button class="linkbtn" data-act="sync">${ICON.sync} Sync</button></div>`;
}
let startKind = null;   // auf dem Start gewählter Plan, null = der zuletzt genutzte
const skind = () => (draft ? draft.plan || 'crew' : hasCrew() ? startKind || curPlan() : 'mine');
const todayWorkout = () => st().workouts.find(w => w.person === cfg.me && dateKey(w.ts) === todayStr());
function viewStart() {
  const s = st(), me = cfg.me, other = partner(), sk = skind();
  const nd = nextDay(me, sk), plan = planOf(me, sk)[nd] || EMPTY_DAY, done = !draft && todayWorkout();
  const dl_ = deloadState(me);
  const nSets = plan.exercises.reduce((a, x) => a + (+x.sets || 0), 0);
  const lastDoneOf = d => s.workouts.filter(w => w.person === me && w.data.day === d && (w.data.plan || 'crew') === sk).pop();
  const lastDone = lastDoneOf(nd);
  const wd = new Date().toLocaleDateString('de-DE', { weekday: 'long' });
  // Rotation: der nächste Tag steht links, danach die Reihenfolge des Plans, der zuletzt trainierte am Ende
  const rdays = pdays(me, sk), ri = Math.max(0, rdays.indexOf(draft ? draft.day : nd)), rorder = rdays.slice(ri).concat(rdays.slice(0, ri));
  const rot = rorder.map(d => {
    const isNext = d === (draft ? draft.day : nd);
    const l = lastDoneOf(d);
    const label = isNext ? (draft ? 'läuft' : 'als Nächstes') : l ? 'zuletzt ' + new Date(l.ts).toLocaleDateString('de-DE', { weekday: 'short' }) : '–';
    return `<div class="rot glass t-${DAY_TONE[d]} ${isNext ? 'next' : ''}"><b><i class="dot t-${DAY_TONE[d]}"></i>${esc(dl(d, me, sk))}</b><span>${label}</span></div>`;
  }).join('');
  const ap = !draft && !done ? pauseOn(me, todayStr()) : null, upc = pausesOf(me).find(x => x.to >= todayStr());
  const pzBtn = on => `<button class="btn pzbtn ${on ? 'on' : 'ghost'}" data-act="pause-open" aria-label="${on ? 'Pause bearbeiten' : 'Pause eintragen'}">${ICON.hourglass}</button>`;
  let main;
  if (ap) {
    const r = pzReason(ap), left = dayNum(ap.to) - dayNum(todayStr()) + 1;
    const rest = left <= 1 ? 'Heute ist dein letzter Pausentag.' : `Noch ${left} Tage Pause.`;
    const txt = ap.reason === 'urlaub' && r ? 'Genieß die freien Tage. Deine Flamme wartet auf dich.' : `${rest} Dein Wochenziel ist angepasst, deine Flamme bleibt.`;
    main = `<div class="eyebrow">Pause${r ? ' · ' + r.label : ''} · bis ${pzDate(ap.to)}</div>
      <h1 class="kurz" style="color:${TONE_HEX[DAY_TONE[nd]]};opacity:.35">${esc(dl(nd, me, sk))}</h1><div class="title" style="color:var(--dim)">${esc(plan.title)} · danach als Nächstes</div>
      <section class="card glass pzcard"><span class="pz-ic">${ICON[r ? r.icon : 'hourglass']}</span><span style="display:flex;flex-direction:column;gap:2px"><b>${r ? r.title : 'Deine Pause läuft'}</b><span class="small muted">${txt}</span></span></section>
      <div class="btnrow" style="padding-top:8px"><button class="btn ghost" data-act="start">Doch trainieren</button>${pzBtn(true)}</div>`;
  } else if (draft) {
    main = `<div class="eyebrow">Training läuft${draft.deload ? ' · Deload' : ''}</div>
      <h1 class="kurz" style="color:${TONE_HEX[DAY_TONE[draft.day]]}">${esc(dl(draft.day, me, draft.plan))}</h1><div class="title">${esc(draft.title)}</div>
      <div class="mono muted small">begonnen ${relDay(draft.start)} um ${fmtTime(draft.start)}</div>
      <div class="btnrow" style="padding-top:8px"><a class="btn primary" href="#training">Training fortsetzen</a></div>`;
  } else if (done) {
    main = `<div class="eyebrow">Heute schon trainiert · ${esc(dl(done.data.day, me, done.data.plan))}</div>
      <h1 class="kurz" style="color:${TONE_HEX[DAY_TONE[nd]]}">${esc(dl(nd, me, sk))}</h1><div class="title">${esc(plan.title)}</div>
      <div class="mono muted small">Als Nächstes · ab morgen</div>
      <span class="small muted">Ein Training pro Tag. Gönn deinen Muskeln die Pause, sie wachsen in der Regeneration.</span>
      <div class="btnrow" style="padding-top:8px"><a class="btn" href="#training-log:${encodeURIComponent(done.id)}">Heutiges Training ansehen</a></div>`;
  } else {
    main = `<div class="eyebrow">${dl_.active ? `Deload · Teil ${dl_.part} von 3` : `Als Nächstes · ${wd}`}</div>
      <h1 class="kurz" style="color:${TONE_HEX[DAY_TONE[nd]]}">${esc(dl(nd, me, sk))}</h1><div class="title">${esc(plan.title)}</div>
      <div class="mono muted small">${plan.exercises.length} Übungen · ${dl_.active ? `${plan.exercises.reduce((a, x) => a + Math.ceil((+x.sets || 1) / 2), 0)} Sätze (halbiert)` : `${nSets} Sätze`}${lastDone ? ` · zuletzt ${relDay(lastDone.ts)}` : ''}</div>
      ${regenHint(nd)}
      ${dl_.active ? (dl_.reentry ? `<div class="deload"><b>Sanfter Wiedereinstieg</b><span class="muted">${dl_.reentry} Tage Pause. ${dl_.part === 1 ? 'Die nächsten 3 Trainings laufen' : `Noch ${4 - dl_.part} ${4 - dl_.part === 1 ? 'Training läuft' : 'Trainings laufen'}`} als Deload: Gewicht −10 %, halbe Sätze, Wiederholungen am unteren Ende.</span></div>`
        : `<div class="deload"><b>Deload-Woche</b><span class="muted">${esc(dl_.reason)}. Gewicht −10 %, halbe Sätze, Wiederholungen am unteren Ende. Danach geht es mit deinen bisherigen Gewichten weiter.</span></div>`) : ''}
      <div class="btnrow" style="padding-top:8px">
        <button class="btn primary" data-act="start">${dl_.active ? 'Training mit Deload starten' : 'Training starten'}</button>${pzBtn(!!upc)}
      </div>
      ${dl_.active ? '<button class="btn ghost" data-act="start-normal">Heute normal trainieren</button>' : ''}
      ${otherDayAsk ? `<div class="confirm"><div><b>Welchen Tag trainierst du heute?</b><br><span class="small muted">Deine Rotation geht danach ab diesem Tag weiter.</span></div>
        <div class="excwarn">${ICON.warn}<span>Nur als Ausnahme: Häufiges Auslassen stört die Rotation und fördert muskuläres Ungleichgewicht.</span></div>
        <div class="pick">${pdays(me, sk).filter(d => d !== nd).map(d => `<button data-act="start-day" data-v="${d}">${esc(dl(d, me, sk))}</button>`).join('')}</div>
        ${pdays(me, sk).filter(d => d !== nd).map(d => regenHint(d, true)).join('')}
        <button class="btn small ghost" data-act="other-no">Abbrechen</button></div>` : ''}
      ${otherDayAsk ? '' : `<button class="lnk" data-act="other-day" style="align-self:flex-start">Anderen Tag trainieren</button>`}`;
  }
  const install = !(navigator.standalone || matchMedia('(display-mode: standalone)').matches) && /iPhone|iPad/.test(navigator.userAgent)
    ? `<div class="install glass">Tipp: Tippe in Safari auf <b>Teilen</b> und dann <b>Zum Home-Bildschirm</b>. Dann läuft die App wie eine normale App und auch offline.</div>` : '';
  // Neuigkeiten: die letzten drei Ereignisse der vergangenen 7 Tage, Neues oben. Alles Weitere über „Alle“ im Verlauf.
  const week = s.feed.filter(e => Date.now() - new Date(e.ts) < 7 * 864e5), feed = week.slice(0, 3);
  const kseg = hasCrew() && !draft ? `<div class="seg" role="group" aria-label="Plan"><button data-act="skind" data-v="mine" aria-pressed="${sk === 'mine'}">Mein Plan</button><button data-act="skind" data-v="crew" aria-pressed="${sk === 'crew'}">Crew-Plan</button></div>` : '';
  return `${install}${kseg}
    <section class="hero">${main}</section>
    <div class="rotation${rorder.length > 3 ? ' scroll' : ''}" aria-label="Deine Rotation">${rot}</div>
    ${syncLine()}
    <div class="sec-title"><h2>Neuigkeiten${week.length > 3 ? ` <span class="mono muted sec-n">3 von ${week.length}</span>` : ''}</h2>${s.feed.length ? '<a href="#verlauf">Alle</a>' : ''}</div>
    <section class="card" style="padding:4px 16px">${feed.length ? `<div class="feed">${feed.map(feedItem).join('')}</div>` : (s.feed.length ? '<div class="empty">Diese Woche noch nichts Neues. Alles Ältere findest du im Verlauf.</div>' : '<div class="empty">Hier erscheinen eure Trainings, Steigerungen und Skips.</div>')}</section>
    ${flameList()}
    ${progressCard()}`;
}
/* Sheet „Pause eintragen“: Grund, Zeitraum (Schnellauswahl oder Kalender), Teilen */
let PZS = null;
const sundayOf = s => addDays(s, (7 - new Date(s + 'T12:00').getDay()) % 7);
function pauseOpen() {
  const t = todayStr(), cur = pausesOf(cfg.me).find(x => x.to >= t);
  PZS = cur ? { pid: cur.pid, from: cur.from, to: cur.to, reason: cur.reason, quick: '', step: 0, m: cur.from.slice(0, 7), edit: true, min0: cur.from }
    : { from: t, to: sundayOf(t), reason: '', quick: 'sonntag', step: 0, m: t.slice(0, 7) };
  pauseSheet();
}
function pauseSheet() {
  if (!PZS) return;
  const z = PZS, t = todayStr(), min = [dateKey(weekOf(Date.now())), z.min0 || t].sort()[0], max = addDays(t, 120);
  const R = z.reason && PZ_REASON[z.reason], ask = R && R.health && !hasConsent('health');
  const pill = (act, v, on, label, icon) => `<button class="pzpill${on ? ' on' : ''}" data-act="${act}" data-v="${v}" aria-pressed="${on}">${icon ? ICON[icon] : ''}${label}</button>`;
  const reasons = Object.entries(PZ_REASON).map(([k, r]) => pill('pz-reason', k, z.reason === k, r.label, r.icon)).join('');
  const quick = [['heute', 'Nur heute'], ['sonntag', 'Bis Sonntag'], ['drei', '3 Tage']].map(([k, l]) => pill('pz-quick', k, z.quick === k, l)).join('');
  const [y, mo] = z.m.split('-').map(Number), first = new Date(y, mo - 1, 1), off = (first.getDay() + 6) % 7, n = new Date(y, mo, 0).getDate();
  let cells = '';
  for (let i = 0; i < off; i++) cells += '<span></span>';
  for (let d = 1; d <= n; d++) {
    const k = `${z.m}-${pad2(d)}`, dis = k < min || k > max, end = k === z.from || k === z.to, inr = k > z.from && k < z.to;
    cells += `<button class="pzd${dis ? ' off' : end ? ' end' : inr ? ' in' : ''}${k === t ? ' today' : ''}" data-act="pz-day" data-v="${k}" ${dis ? 'disabled' : ''} aria-pressed="${end || inr}">${d}</button>`;
  }
  const title = first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const days = dayNum(z.to) - dayNum(z.from) + 1, rl = R && !ask ? R.label : '';
  const summary = `${pzDate(z.from)}${z.from !== z.to ? ' – ' + pzDate(z.to) : ''} · ${days} ${days === 1 ? 'Tag' : 'Tage'}${rl ? ' · ' + rl : ''}`;
  const sh = sharePause();
  sheet(`<div class="rowbetween" style="align-items:center"><h2>${z.edit ? 'Pause bearbeiten' : 'Pause eintragen'}</h2><button class="iconbtn glass" data-act="mclose" aria-label="Schließen">${ICON.x}</button></div>
    <div class="pzsec"><span class="eyebrow">Grund</span><div class="pzpills">${reasons}</div>
      ${ask ? `<div class="card pzask"><span class="small">„${R.label}“ ist eine Gesundheitsangabe. Dafür brauchen wir einmal deine Einwilligung, wie beim Körpergewicht.</span>
        <div class="btnrow"><button class="btn small primary" data-act="pz-consent">Einwilligen</button><button class="btn small ghost" data-act="pz-noreason">Nur „Pause“</button></div></div>` : ''}</div>
    <div class="pzsec"><span class="eyebrow">Zeitraum</span><div class="pzpills">${quick}</div></div>
    <div class="pzsec"><div class="calnav"><button class="iconbtn" data-act="pz-month" data-v="-1" aria-label="Voriger Monat" ${z.m <= min.slice(0, 7) ? 'disabled' : ''}>${ICON.left}</button><b>${title}</b><button class="iconbtn" data-act="pz-month" data-v="1" aria-label="Nächster Monat" ${z.m >= max.slice(0, 7) ? 'disabled' : ''}>${ICON.right}</button></div>
      <div class="pzcal">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(w => `<span class="wd">${w}</span>`).join('')}${cells}</div>
      <span class="mono small muted">${z.step ? 'Letzten Tag wählen' : 'Ersten Tag antippen, dann den letzten'}</span></div>
    <label class="row tgl" style="cursor:pointer;padding:0"><span style="display:flex;flex-direction:column;gap:2px"><span>Pause mit Buddys teilen</span><span class="small muted">${sh ? 'Crew und Freunde sehen „Pause bis …“, keinen Grund.' : 'Aus: Deine Buddys sehen nichts davon.'}</span></span><input type="checkbox" role="switch" id="pz-share" ${sh ? 'checked' : ''}><i aria-hidden="true"></i></label>
    <button class="lnk" data-act="pz-privacy" style="align-self:flex-start;padding:0">Wer sieht was? Privatsphäre-Einstellungen</button>
    <span class="mono small" style="text-align:center;color:var(--dim)">${summary}</span>
    <button class="btn primary" data-act="pz-save" ${ask ? 'disabled' : ''}>${z.edit ? 'Speichern' : 'Pause eintragen'}</button>
    ${z.edit ? `<button class="btn ghost danger-t" data-act="pz-end">${z.from > t ? 'Pause löschen' : 'Pause beenden'}</button>` : ''}`);
}
function pzQuick(k) { const t = todayStr(); PZS.quick = k; PZS.step = 0; PZS.from = t; PZS.to = k === 'heute' ? t : k === 'drei' ? addDays(t, 2) : sundayOf(t); PZS.m = t.slice(0, 7); pauseSheet(); }
function pzDay(k) {
  const z = PZS; z.quick = '';
  if (!z.step) { z.from = z.to = k; z.step = 1; }
  else { if (k < z.from) { z.to = z.from; z.from = k; } else z.to = k; z.step = 0; }
  pauseSheet();
}
function pzSave() {
  const z = PZS; if (!z) return;
  const R = PZ_REASON[z.reason]; if (R && R.health && !hasConsent('health')) return;
  savePause({ pid: z.pid, from: z.from, to: z.to, reason: z.reason });
  const msg = z.edit ? 'Pause gespeichert' : z.reason === 'krank' || z.reason === 'verletzt' ? 'Pause eingetragen. Gute Besserung!' : z.reason === 'urlaub' ? 'Pause eingetragen. Schönen Urlaub!' : 'Pause eingetragen';
  PZS = null; closeModal(); toast(msg); render();
}
function pzEnd() {
  const z = PZS; if (!z || !z.pid) return;
  const t = todayStr(), y = addDays(t, -1);
  savePause(z.from <= y ? { pid: z.pid, from: z.from, to: y, reason: z.reason } : { pid: z.pid, from: z.from, to: z.to, deleted: true });
  PZS = null; closeModal(); toast(z.from > t ? 'Pause gelöscht' : 'Pause beendet. Schön, dass du wieder da bist!'); render();
}
async function setSharePause(v, el) {
  const r = await sb.from('profiles').update({ share_pause: v }).eq('id', cfg.me);
  if (r.error) { toast('Speichern hat nicht geklappt.'); if (el) el.checked = !v; return; }
  if (PROFILES[cfg.me]) PROFILES[cfg.me].share_pause = v; LS.set('profiles', PROFILES);
  pauseMirrors(v);
  if (PZS && $('#pz-share')) pauseSheet(); else render();
}
// Hinweis, wenn derselbe Trainingstag noch keine REGEN_H Stunden her ist (ändert nichts an den Flammen)
function regenHint(d, small) {
  const l = st().workouts.filter(w => w.person === cfg.me && w.data.day === d).pop();
  if (!l) return '';
  const h = (Date.now() - new Date(l.ts)) / 36e5;
  if (h >= REGEN_H) return '';
  const at = new Date(new Date(l.ts).getTime() + REGEN_H * 36e5);
  const when = `${at.toLocaleDateString('de-DE', { weekday: 'short' })} ${fmtTime(at.toISOString())}`;
  return `<div class="regen ${small ? 'small' : ''}"><span class="nic" aria-hidden="true">${ICON.moon}</span><span>${esc(dl(d))} war vor ${Math.max(1, Math.round(h))} h. Empfohlen sind mindestens ${REGEN_H} h Regeneration, also ab ${esc(when)}.</span></div>`;
}
function feedItem(e) {
  const d = e.data || {}, p = e.person, me = p === cfg.me;
  const wait = isPending(e.id) ? '<span class="chip wait">noch nicht synchronisiert</span>' : '';
  let t = '', m = fmtDate(e.ts) + ' · ' + fmtTime(e.ts), extra = '', href = '';
  const who = `<b>${me ? 'Du' : nm(p)}</b>`;
  if (e.type === 'workout') return feedWorkout(e);
  if (e.type === 'workout_edit') {
    const w = st().workouts.find(x => x.id === d.ref); if (!w) return '';
    t = `${dayChip(w.data.day, d.as)}<span>${who} ${me ? 'hast' : 'hat'} ${d.as === cfg.me ? 'dein' : esc(d.as) + 's'} Training vom ${fmtDate(w.ts)} angepasst</span>`;
    extra = (d.chg.length ? d.chg : ['Werte korrigiert']).map(c => `<span class="chip">${esc(c)}</span>`).join('');
    href = '#training-log:' + encodeURIComponent(w.id);
  } else if (e.type === 'swap') {
    t = `${dayChip(d.day, p)}<span>${who} ${me ? 'hast' : 'hat'} heute ${esc(d.fromName)} durch ${esc(d.to.name)} getauscht</span>`;
    extra = '<span class="chip">für beide</span>';
  }
  let th = '';
  if (e.type === 'spot_react') {
    t = `<span>${who} ${me ? 'hast' : 'hat'} auf deinen Spot reagiert <span class="emo">${esc(d.emoji)}</span></span>`;
    const g = SPOT.gallery.find(x => x.id === d.spot);
    if (g) { href = '#spot-bild:' + encodeURIComponent(g.id); th = `<span class="fi-th"><img src="${spotUrl(g)}" alt="Spot öffnen"></span>`; }
  }
  const inner = `<span class="avlink" data-act="goprof" data-p="${esc(p)}">${avatar(p, 34)}</span><div><div class="t">${t}</div><div class="m">${m}</div>${extra || wait ? `<div class="chips">${extra}${wait}</div>` : ''}</div>${th}`;
  return href ? `<a class="fi ${th ? 'has-th' : ''}" href="${href}">${inner}</a>` : `<div class="fi">${inner}</div>`;
}

/* Training in den Neuigkeiten: wer, wann, wie lange. Darunter die Sätze und die Rekorde, eingeklappt hinter „Rekord“ in Tagesfarbe.
   Antippen führt zu den Details. */
const FEED_OPEN = new Set();
function feedWorkout(e) {
  const d = e.data || {}, p = e.person, me = p === cfg.me, ab = e.abort;
  const n = (d.entries || []).reduce((a, en) => a + en.sets.length, 0);
  const prs = improvements(e).filter(i => i.pr), col = TONE_HEX[DAY_TONE[d.day]] || '#fff', open = FEED_OPEN.has(e.id);
  const wait = isPending(e.id) ? '<span class="chip wait">noch nicht synchronisiert</span>' : '';
  const recBtn = prs.length ? `<button class="fi-rec" data-act="feed-rec" data-id="${esc(e.id)}" aria-expanded="${open}" style="color:${col}">${ICON.trophy}${prs.length === 1 ? 'Rekord' : prs.length + ' Rekorde'}<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>` : '';
  return `<div class="fi fi-w"><span class="avlink" data-act="goprof" data-p="${esc(p)}">${avatar(p, 34)}</span><div>
      <a class="fi-link" href="#training-log:${encodeURIComponent(e.id)}"><div class="t"><span class="day t-${DAY_TONE[d.day]}">${esc(wlabel(e))}</span><span><b>${me ? 'Du' : nm(p)}</b> ${me ? 'hast' : 'hat'} ${ab ? 'abgebrochen' : 'abgeschlossen'}</span></div>
      <div class="m">${fmtDate(e.ts)} · ${fmtTime(e.ts)} · ${duration(d.start, d.end)}</div></a>
      <div class="fi-l2"><span class="muted">${ab ? `${ab.done} von ${ab.plan} Sätzen` : `${n} ${n === 1 ? 'Satz' : 'Sätze'}`}</span>${d.deload ? '<span class="chip dl">Deload</span>' : ''}${recBtn}${wait}</div>
      ${open ? `<div class="fi-recs">${prs.map(i => `<div><span>${esc(i.name.replace(/\s*\(.*\)$/, ''))}</span><span class="mono" style="color:${col}">${esc(i.label)}</span></div>`).join('')}</div>` : ''}
      ${(() => { // Crew-Notizen zu diesem Training gebündelt, private nie
        const k = liveNotes().filter(x => x.workout_id === e.id && x.scope === 'crew' && x.user_id === p).length;
        return k ? `<a class="fi-notes" href="#training-log:${encodeURIComponent(e.id)}">${ICON_CREW14}${me ? 'Du hast' : nm(p) + ' hat'} ${k === 1 ? 'eine Notiz' : k + ' Notizen'} geschrieben</a>` : ''; })()}
    </div></div>`;
}

/* ---------- Training ---------- */
function normalizeDraft(d) {
  if (!d || !Array.isArray(d.items)) return null;
  d.swapIgnored = d.swapIgnored || [];
  const tm = d.tmr;
  TIMER = tm && d.items[tm.i] && d.items[tm.i].sets[tm.j] && tm.total > 0 ? { i: tm.i, j: tm.j, f: tm.f === 'r' ? 'r' : 'w', total: +tm.total, start: +tm.start, acc: +tm.acc || 0, paused: !!tm.paused } : null;
  d.items.forEach(it => {
    it.ex = cleanEx(it.ex); it.note = it.note || ''; it.feel = it.feel || ''; it.wu = it.wu || [];
    it.sets = (it.sets || []).map(s => ({ w: s.w ?? '', neg: !!s.neg, alt: s.alt ?? '', r: s.r ?? '', done: !!s.done, f: SET_FEEL[s.f] ? s.f : '', mk: s.mk || '', lab: s.lab || '', man: !!s.man, add: !!s.add, a: ADD_WHY[s.a] ? s.a : '', t: int(s.t) || 0, ph: s.ph == null || s.ph === '' ? null : num(s.ph) }));
    it.rm = Array.isArray(it.rm) ? it.rm.map(r => (REM_WHY[r] ? r : '')) : [];
    it.tt = int(it.tt) || (it.ex.type === 'tr' ? it.ex.min : 0);
    if (it.hint === undefined) { try { const pl = planFor(it.ex); it.hint = d.deload ? DELOAD_HINT : pl.hint; it.kind = d.deload ? 'deload' : pl.kind; } catch (e) { it.hint = ''; it.kind = ''; } }
  });
  return d;
}
const DELOAD_HINT = 'Deload: Gewicht −10 %, halbe Sätze, Wiederholungen am unteren Ende.';
// Ein Satz im laufenden Training. Bei Körpergewichtsübungen ist w der Wert der aktiven Seite (+ Zusatz oder − Abzug), alt der gemerkte Wert der anderen Seite.
function blankSet(w, extra = {}) { return { w: w == null || w === 0 ? '' : fmtIn(w), neg: w < 0, alt: '', r: '', done: false, f: '', mk: '', lab: '', man: false, ...extra }; }
function newItem(x, deload) {
  const pl = planFor(x);
  let n = Math.max(1, +x.sets || 1), plan = pl.sets.slice(0, n), hint = pl.hint, kind = pl.kind;
  if (deload) {
    n = Math.max(1, Math.ceil(n / 2));
    const w = x.type === 'tr' ? x.min : pl.base == null ? null : roundTo(deloadW(pl.base), stepOf(x));
    plan = Array.from({ length: n }, () => ({ w, mk: w == null ? '' : 'deload', lab: w == null ? '' : 'DELOAD' }));
    hint = DELOAD_HINT; kind = 'deload';
  }
  const sets = plan.map((ps, j) => {
    const w = x.type === 'time' ? null : ps.w;
    const s = blankSet(w, { mk: ps.mk || '', lab: ps.lab || '', t: deload ? 0 : ps.t || 0, ph: deload || ps.ph == null ? null : ps.ph });
    if (x.type === 'bw') {
      const side = lastSides(cfg.me, x, j);
      s.alt = s.neg ? fmtIn(side.plus) : fmtIn(side.minus);
    }
    return s;
  });
  return { ex: x, note: '', feel: '', wu: [], swappedFrom: null, swapBy: null, removed: false, hint, kind, sets, tt: x.type === 'tr' ? (deload ? x.min : pl.tt || x.min) : 0, rm: [] };
}
function partnerSwapsToday(day) {
  const mates = crewMates(), latest = {};
  if (draft && draft.plan === 'mine') return [];
  st().swaps.filter(e => mates.includes(e.person) && e.data.day === day && e.data.date === todayStr()).forEach(e => { latest[e.data.fromId] = e; });
  return Object.values(latest);
}
function startTraining(skipDeload, pick, k = skind()) {
  if (todayWorkout()) { toast('Heute schon trainiert. Morgen geht es weiter.'); return; }
  const me = cfg.me, day = pdays(me, k).includes(pick) ? pick : nextDay(me, k), plan = planOf(me, k)[day];
  if (!plan) return;
  const dlS = deloadState(me), deload = dlS.active && !skipDeload;
  draft = { day, plan: k, title: plan.title, start: new Date().toISOString(), deload, deloadSkipped: dlS.active && !!skipDeload, swapIgnored: [], items: plan.exercises.map(x => newItem(clone(x), deload)) };
  if (k === 'crew') partnerSwapsToday(day).forEach(sw => {
    const i = draft.items.findIndex(t => t.ex.id === sw.data.fromId);
    if (i < 0) return;
    const it = newItem(clone(sw.data.to), deload);
    it.swappedFrom = { id: sw.data.fromId, name: sw.data.fromName }; it.swapBy = sw.person;
    draft.items[i] = it;
  });
  saveDraft(); location.hash = '#training';
}
const hasEntries = it => it.sets.some(s => s.done || int(s.r) > 0) || !!(it.note || '').trim() || !!(it.cnote || '').trim();
const workCount = () => { let done = 0, tot = 0; draft.items.forEach(it => it.sets.forEach(s => { tot++; if (s.done) done++; })); return { done, tot }; };
function trainCountText() { const { done, tot } = workCount(); return draft.edit ? `${done} / ${tot} Sätze` : `${done} / ${tot} Sätze · ${duration(draft.start, new Date().toISOString())}`; }
function viewTraining() {
  const { done, tot } = workCount();
  return `<header class="trainhead" id="head">
      <div class="row">${backBtn('start', 'Zurück zum Start')}<span class="count" id="tp-count">${trainCountText()}</span>${bellBtn('tbell')}</div>
      <div class="ttl"><div><h1 class="kurz">${esc(dl(draft.day, null, draft.plan))}</h1><div class="sub">${esc(draft.title)}</div></div>${draft.deload ? '<span class="pill dl">Deload</span>' : ''}</div>
      <div class="bar"><i id="tp-bar" style="width:${tot ? done / tot * 100 : 0}%"></i></div>
    </header>
    <main class="view notab">${draft.items.map((it, i) => exCard(it, i)).join('')}</main>
    ${timerBar()}
    <div class="trainbar"><button class="btn primary" data-act="finish-ask">Training abschließen</button><button class="btn x" data-act="discard-ask" aria-label="Training verwerfen">${ICON.x}</button></div>`;
}
function pendingSwapFor(it) {
  if (!draft || draft.edit || it.swappedFrom || it.removed) return null;
  return partnerSwapsToday(draft.day).find(sw => sw.data.fromId === it.ex.id && !draft.swapIgnored.includes(sw.id)) || null;
}
const hasWarmup = it => it.ex.warmup && it.ex.type === 'kg' && !it.removed && !(draft && draft.edit);
function warmupLabel(it) {
  const W = num(it.sets[0] && it.sets[0].w) || workW(it.sets.map(s => ({ w: s.w, r: 1 })));
  const [p, reps] = WARMUP;
  if (!(W > 0)) return `Aufwärmen · ${Math.round(p * 100)} % × ${reps}`;
  const kg = Math.min(W, Math.max(W >= 20 ? 20 : 0, roundTo(W * p, 2.5)));
  return `Aufwärmen · ${fmtN(kg)} kg × ${reps}`;
}
// Eingabe der Notiz im Training: Mein Plan nur privat, Crew-Plan mit Umschalter Privat / Crew (jede Seite mit eigenem Text)
function noteInput(it, i) {
  if (draft.plan === 'mine' || !hasCrew()) return `<label class="note"><span>${ICON_LOCK14} Notiz · Privat</span><textarea id="note-${i}" data-note="${i}" rows="2" placeholder="z. B. Schulter zwickt, nächstes Mal enger greifen">${esc(it.note || '')}</textarea></label>`;
  const sc = it.nscope === 'crew' ? 'crew' : 'private';
  return `<div class="note"><div class="seg nswitch" role="group" aria-label="Notiz für"><button type="button" data-act="nscope" data-i="${i}" data-v="private" aria-pressed="${sc === 'private'}">${ICON_LOCK14}Privat${(it.note || '').trim() && sc !== 'private' ? ' ·' : ''}</button><button type="button" data-act="nscope" data-i="${i}" data-v="crew" aria-pressed="${sc === 'crew'}">${ICON_CREW14}Crew${(it.cnote || '').trim() && sc !== 'crew' ? ' ·' : ''}</button></div>
    <textarea id="note-${i}" data-note="${i}" data-scope="${sc}" rows="2" aria-label="${sc === 'crew' ? 'Notiz für deine Crew' : 'Private Notiz'}" placeholder="${sc === 'crew' ? 'Deine Crew sieht diese Notiz, z. B. Bank 3 wackelt' : 'Nur du siehst diese Notiz, z. B. Schulter zwickt'}">${esc(sc === 'crew' ? it.cnote || '' : it.note || '')}</textarea></div>`;
}
function exCard(it, i) {
  const x = it.ex, me = cfg.me;
  const mine = lastAny(me, x.id);
  const unit = isTimed(x.type) ? ' s' : '';
  const hint = it.hint || '';
  const sw = pendingSwapFor(it);
  const lastReps = j => x.type === 'tr' ? (mine && mine.type === 'tr' && mine.sets[j] ? mine.sets[j].r : '–') : (draft.deload ? x.min : mine && mine.type === x.type && mine.sets[j] ? mine.sets[j].r : x.max);
  const tField = (s, j, f) => {
    const tm = !draft.edit && TIMER && TIMER.i === i && TIMER.j === j ? TIMER : null;
    const left = tm ? tmrLeft() : 0;
    const ph = f === 'r' ? lastReps(j) : (it.tt || x.min);
    return `<div class="field kgf tf ${tm ? (tm.paused ? 'pause' : 'run') : ''}" id="tf-${i}-${j}" ${tm ? `style="--p:${Math.round((1 - left / tm.total) * 100)}%"` : ''}><button class="sign" data-act="tmr" data-i="${i}" data-j="${j}" ${s.done || draft.edit ? 'disabled' : ''} aria-label="${tm ? (tm.paused ? 'Timer fortsetzen' : 'Timer pausieren') : `Timer Satz ${j + 1} starten`}">${tm && !tm.paused ? ICON.pause : ICON.play}</button><input id="${f}-${i}-${j}" data-i="${i}" data-j="${j}" data-f="${f}" inputmode="numeric" autocomplete="off" aria-label="Sekunden Satz ${j + 1}" value="${tm ? fmtClock(left) : esc(s[f])}" placeholder="${ph}" ${tm ? 'readonly' : ''}><span>s</span></div>`;
  };
  const wField = (s, j) => {
    if (x.type === 'tr') return tField(s, j, 'w');
    if (x.type === 'kg') return `<label class="field ${s.mk ? 'mk-' + s.mk : ''}${s.ph != null ? ' wphf' : ''}"><input id="w-${i}-${j}" data-i="${i}" data-j="${j}" data-f="w" inputmode="decimal" autocomplete="off" aria-label="Gewicht Satz ${j + 1}${s.ph != null ? `, eine Platte schwerer als ${fmtN(s.ph)} kg` : ''}" value="${esc(s.w)}" placeholder="${s.ph != null ? ' ' : '–'}"><span>kg</span>${s.ph != null ? `<span class="wph" aria-hidden="true"><b>↑</b> ${fmtN(s.ph)}</span>` : ''}</label>`;
    if (x.type !== 'bw') return '';
    const st_ = num(s.w) > 0 ? (s.neg ? 'minus' : 'plus') : '';
    return `<div class="field kgf ${st_}" id="wf-${i}-${j}"><button class="sign" data-act="sign" data-i="${i}" data-j="${j}" ${s.done ? 'disabled' : ''} aria-label="${s.neg ? 'Abzug' : 'Zusatzgewicht'}${s.done ? ', gesperrt solange abgehakt' : `, tippen für ${s.neg ? 'Zusatzgewicht' : 'Abzug'}`}">${s.neg ? '−' : '+'}</button><input id="w-${i}-${j}" data-i="${i}" data-j="${j}" data-f="w" inputmode="decimal" autocomplete="off" aria-label="${s.neg ? 'Abzug' : 'Zusatzgewicht'} Satz ${j + 1}" value="${esc(s.w)}" placeholder="0"><span>kg</span></div>`;
  };
  const feelRow = (s, j) => s.done ? `<div class="sfeel" role="group" aria-label="Wie war Satz ${j + 1}?">${Object.entries(SET_FEEL).map(([k, v]) => `<button data-act="sfeel" data-i="${i}" data-j="${j}" data-v="${k}" aria-pressed="${s.f === k}">${v}</button>`).join('')}</div>` : '';
  const rows = it.sets.map((s, j) => `<div class="set ${s.done ? 'ok' : ''}">
      <span class="n">${j + 1}</span>${wField(s, j)}
      ${x.type === 'time' ? tField(s, j, 'r') : `<label class="field"><input id="r-${i}-${j}" data-i="${i}" data-j="${j}" data-f="r" inputmode="numeric" autocomplete="off" aria-label="Wiederholungen Satz ${j + 1}" value="${esc(s.r)}" placeholder="${s.t && !draft.deload ? 'mind. ' + s.t : lastReps(j)}"${s.t && !draft.deload ? ' class="rt"' : ''}><span>×</span></label>`}
      <button class="check" data-act="check" data-i="${i}" data-j="${j}" aria-label="Satz ${j + 1} erledigt" aria-pressed="${s.done}">${ICON.check}</button>
    </div>${s.lab && x.type !== 'time' ? `<div class="setlab" id="sl-${i}-${j}"><span></span><span class="${s.mk === 'deload' ? 'dl' : ''}">${esc(s.lab)}</span></div>` : ''}${feelRow(s, j)}`).join('');
  const cols = x.type === 'time' ? `<div class="cols"><span></span><span class="r">Sekunden</span><span></span></div>`
    : x.type === 'tr' ? `<div class="cols"><span></span><span class="r">Zeit</span><span class="r">Wdh.</span><span></span></div>`
    : `<div class="cols"><span></span><span class="r">${x.type === 'bw' ? '± kg' : 'kg'}</span><span class="r">Wdh.</span><span></span></div>`;
  const warm = hasWarmup(it) ? `<div class="wsets"><div class="wset ${it.wu[0] ? 'ok' : ''}"><span class="n">W</span><span class="wv" id="wu-${i}">${warmupLabel(it)}</span><button class="check" data-act="wu" data-i="${i}" aria-label="Aufwärmsatz erledigt" aria-pressed="${!!it.wu[0]}">${ICON.check}</button></div></div>` : '';
  const kgTag = '';
  const tags = [it.swappedFrom ? `<span class="tag">${draft.edit ? 'statt' : 'Heute statt'} ${esc(it.swappedFrom.name)}${it.swapBy && it.swapBy !== me ? ` · von ${esc(it.swapBy)}` : ''}</span>` : '', it.removed ? '<span class="tag warn">Nicht mehr im Plan</span>' : '', x.personal ? '<span class="tag">Nur ich</span>' : '', kgTag].join('');
  return `<article class="ex glass ${it.sets.length && it.sets.every(s => s.done) ? 'done' : ''} ${it.removed ? 'gone' : ''}" data-card="${i}" data-swaphint="${sw ? esc(sw.id) : ''}">
    <div class="ex-head"><div class="nm"><h3>${esc(x.name)}</h3>
      ${tags ? `<div class="tags">${tags}</div>` : ''}</div>
      <span class="tgt">${it.sets.length}×${x.min}–${x.max}${unit}</span></div>
    ${hint ? `<div class="exhint">${esc(hint)}${it.kind === 'plateau' && !draft.deload ? `<div class="btnrow"><button class="btn small" data-act="plateau-down" data-i="${i}">Heute −10 %</button></div><span class="small muted">Oder im Plan die Spanne anheben, z. B. ${x.min}–${x.max} → ${x.min + 2}–${x.max + 2}.</span>` : ''}</div>` : ''}
    ${sw ? `<div class="swaphint"><span><b>${nm(sw.person)}</b> hat heute ${esc(sw.data.fromName)} durch <b>${esc(sw.data.to.name)}</b> getauscht.</span><div class="btnrow"><button class="btn small primary" data-act="swap-follow" data-i="${i}" data-id="${esc(sw.id)}">Auch tauschen</button><button class="btn small ghost" data-act="swap-ignore" data-id="${esc(sw.id)}">Nein</button></div></div>` : ''}
    <div class="howrow"><details class="how"><summary>Ausführung & Video</summary><div class="body">
      ${(() => { const Lx = libGet(x.id), cue = Lx ? Lx.cue : x.cue; return cue ? `<p style="white-space:pre-line">${esc(cue)}</p>` : '<p class="small warn-t">Noch keine Ausführungshinweise hinterlegt. Ergänzen unter Plan → Bibliothek.</p>'; })()}
      ${x.image ? `<img src="${esc(x.image)}" alt="${esc(x.name)}" loading="lazy">` : ''}
      ${(() => { const Lx = libGet(x.id), v = (Lx && Lx.video) || x.video; return `<a class="vlink" href="${esc(videoUrl({ name: x.name, video: v }))}" target="_blank" rel="noopener">▶ ${v ? 'Video ansehen' : 'Shorts auf YouTube'}</a>`; })()}
    </div></details>
    <details class="how mus" data-ex="${esc(x.id)}" ${musOpen.has(x.id) ? 'open' : ''}><summary>Muskeln</summary><div class="body">${musBlock(x, DAY_TONE[draft.day])}</div></details></div>
    <div class="sets ${x.type}">${cols}${warm}${rows}</div>
    <div class="cardacts"><button class="addset" data-act="addset" data-i="${i}">+ Satz</button><button class="addset" data-act="delset" data-i="${i}" ${it.sets.length <= 1 ? 'disabled' : ''}>− Satz</button><span class="sp"></span>${it.removed ? '' : `<button class="addset" data-act="swap-open" data-i="${i}">${ICON.swap} ${draft.edit ? 'Tauschen' : 'Heute tauschen'}</button>`}</div>
    ${whyRow(it, i)}
    ${draft.edit ? (it.note ? `<label class="note"><span>Notiz</span><textarea id="note-${i}" data-note="${i}" rows="2">${esc(it.note)}</textarea></label>` : '') : notesBlock(x.id, draft.plan === 'mine' ? 'mine' : 'crew') + noteInput(it, i)}
    ${!draft.edit ? '' : it.ask ? `<div class="btnrow"><button class="btn small danger" data-act="ed-rmex-yes" data-i="${i}">${esc(x.name)} entfernen</button><button class="btn small ghost" data-act="ed-rmex-no" data-i="${i}">Abbrechen</button></div>` : `<button class="lnk danger-t" data-act="ed-rmex" data-i="${i}" style="align-self:flex-start">Übung aus dem Training entfernen</button>`}
  </article>`;
}
// Grund für + / − Satz: kleine Chips, optional. Ohne Auswahl gilt neutral.
function whyRow(it, i) {
  const out = [];
  if (it.rm && it.rm.length) out.push(`<div class="why" role="group" aria-label="Warum weniger Sätze?"><span class="eyebrow">${it.rm.length} ${it.rm.length === 1 ? 'Satz' : 'Sätze'} weniger · warum?</span><div class="chips">${Object.entries(REM_WHY).map(([k, v]) => `<button class="pchip" data-act="why-rm" data-i="${i}" data-v="${k}" aria-pressed="${it.rm[it.rm.length - 1] === k}">${v}</button>`).join('')}</div></div>`);
  const added = it.sets.filter(s => s.add);
  if (added.length) { const la = added[added.length - 1]; out.push(`<div class="why" role="group" aria-label="Warum mehr Sätze?"><span class="eyebrow">${added.length} ${added.length === 1 ? 'Satz' : 'Sätze'} mehr · warum?</span><div class="chips">${Object.entries(ADD_WHY).map(([k, v]) => `<button class="pchip" data-act="why-add" data-i="${i}" data-v="${k}" aria-pressed="${la.a === k}">${v}</button>`).join('')}</div></div>`); }
  return out.join('');
}
/* ---------- Timer für Zeit-Übungen ----------
   Die Restzeit wird aus dem Startzeitpunkt berechnet. Sie stimmt also auch nach gesperrtem Bildschirm,
   einem Sync oder einem Neuladen der App (der Timer steht im gespeicherten Training). */
let TIMER = null, tmrTO = 0, audioCtx = null;
const tmrFieldOf = it => (it.ex.type === 'time' ? 'r' : 'w');
function tmrLeft() { if (!TIMER) return 0; return Math.max(0, TIMER.total - TIMER.acc - (TIMER.paused ? 0 : (Date.now() - TIMER.start) / 1000)); }
function fmtClock(sec) { const v = Math.max(0, Math.ceil(sec)); return Math.floor(v / 60) + ':' + String(v % 60).padStart(2, '0'); }
function tmrSave() { if (draft) { draft.tmr = TIMER ? { ...TIMER } : null; saveDraft(); } }
function audioOn() { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { audioCtx = null; } }
function beep() {
  try {
    audioOn(); if (!audioCtx) throw 0;
    const t0 = audioCtx.currentTime;
    [0, 0.25, 0.5].forEach(o => { const os = audioCtx.createOscillator(), g = audioCtx.createGain(); os.frequency.value = 880; g.gain.setValueAtTime(0.0001, t0 + o); g.gain.exponentialRampToValueAtTime(0.35, t0 + o + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + o + 0.2); os.connect(g); g.connect(audioCtx.destination); os.start(t0 + o); os.stop(t0 + o + 0.22); });
  } catch (e) {}
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
}
function tmrStart(i, j) {
  const it = draft.items[i], f = tmrFieldOf(it);
  if (TIMER) tmrStop();
  it.sets.forEach((st_, k) => readSetInputs(i, k));
  const ph = document.getElementById(`${f}-${i}-${j}`);
  const total = int(it.sets[j][f]) || (f === 'w' ? int(it.tt) : 0) || int(ph && ph.placeholder) || it.ex.min;
  audioOn();
  TIMER = { i, j, f, total, start: Date.now(), acc: 0, paused: false };
  tmrSave(); rerenderCard(i); tmrBar(); tmrTick();
}
function tmrPause() {
  if (!TIMER) return;
  if (TIMER.paused) { TIMER.start = Date.now(); TIMER.paused = false; audioOn(); }
  else { TIMER.acc += (Date.now() - TIMER.start) / 1000; TIMER.paused = true; }
  tmrSave(); rerenderCard(TIMER.i); tmrBar(); tmrTick();
}
// Timer beenden; sec = einzutragende Zeit (null = Satz bleibt leer)
function tmrEnd(sec) {
  if (!TIMER) return;
  const { i, j, f } = TIMER, it = draft.items[i];
  TIMER = null; clearTimeout(tmrTO);
  if (it && it.sets[j] && sec != null) {
    it.sets[j][f] = String(Math.max(1, Math.round(sec)));
    if (it.ex.type === 'time') it.sets[j].done = true;   // reine Zeit-Übung: Satz ist damit erledigt
  }
  tmrSave();
  if (it) rerenderCard(i);
  tmrBar();
  if (it && sec != null && it.ex.type === 'tr') {
    const r = document.getElementById(`r-${i}-${j}`);
    if (r) { r.closest('.field').classList.add('focus'); r.focus({ preventScroll: true }); }
  }
}
function tmrStop() { if (!TIMER) return; const el = TIMER.total - tmrLeft(); tmrEnd(el >= 1 ? el : null); }
function tmrTick() {
  clearTimeout(tmrTO); if (!TIMER) return;
  const left = tmrLeft(), pc = Math.round((1 - left / TIMER.total) * 100) + '%';
  if (left <= 0) { tmrEnd(TIMER.total); beep(); toast('Zeit um'); return; }
  const inp = document.getElementById(`${TIMER.f}-${TIMER.i}-${TIMER.j}`); if (inp) inp.value = fmtClock(left);
  const fld = document.getElementById(`tf-${TIMER.i}-${TIMER.j}`); if (fld) fld.style.setProperty('--p', pc);
  const b = $('#tmr-t'); if (b) b.textContent = fmtClock(left);
  const pr = $('#tmr-p'); if (pr) pr.style.width = pc;
  if (!TIMER.paused) tmrTO = setTimeout(tmrTick, 200);
}
function timerBar() {
  if (!TIMER || !draft || !draft.items[TIMER.i]) return '<div id="tmrbar" hidden></div>';
  const it = draft.items[TIMER.i], left = tmrLeft(), pz = TIMER.paused;
  return `<div class="timerbar glass ${pz ? 'paused' : ''}" id="tmrbar" role="timer" aria-label="${esc(it.ex.name)}, Satz ${TIMER.j + 1}">
    <div class="tt"><span class="eyebrow">${pz ? 'Pausiert · ' : ''}${esc(it.ex.name)} · Satz ${TIMER.j + 1} von ${it.sets.length}</span><b id="tmr-t">${fmtClock(left)}</b></div>
    ${pz ? `<button class="tb" data-act="tmr-x" aria-label="Timer verwerfen, der Satz bleibt leer">${ICON.x}</button>` : ''}
    <button class="tb" data-act="tmr-stop" aria-label="Stoppen und gelaufene Zeit eintragen">${ICON.stop}</button>
    <button class="tb main" data-act="tmr-pause" aria-label="${pz ? 'Fortsetzen' : 'Pausieren'}">${pz ? ICON.play : ICON.pause}</button>
    <i class="prog" id="tmr-p" style="width:${Math.round((1 - left / TIMER.total) * 100)}%"></i></div>`;
}
function tmrBar() { const el = $('#tmrbar'); if (el) el.outerHTML = timerBar(); }
function rerenderCard(i) {
  const el = document.querySelector(`[data-card="${i}"]`);
  if (el) { const d = el.querySelector('details.how'); const open = d && d.open; el.outerHTML = exCard(draft.items[i], i); if (open) document.querySelector(`[data-card="${i}"] details.how`).open = true; }
  updateTrainHead();
}
function updateTrainHead() {
  const { done, tot } = workCount();
  const c = $('#tp-count'), b = $('#tp-bar'), bell = $('#tbell');
  if (c) c.textContent = trainCountText();
  if (b) b.style.width = (tot ? done / tot * 100 : 0) + '%';
  if (bell) bell.outerHTML = bellBtn('tbell');
}
function refreshTraining() {
  if (!draft || view !== 'training') return;
  if (document.querySelectorAll('[data-card]').length !== draft.items.length) { if (!document.activeElement || !$('#app').contains(document.activeElement)) render(); return; }
  document.querySelectorAll('[data-card]').forEach(el => {
    const i = +el.dataset.card, sw = pendingSwapFor(draft.items[i]);
    if ((el.dataset.swaphint || '') !== (sw ? sw.id : '') && !el.contains(document.activeElement) && !(TIMER && TIMER.i === i)) rerenderCard(i);
  });
  updateTrainHead();
}
function collectEntries() {
  return draft.items.map(it => {
    const x = it.ex;
    const sets = it.sets.filter(s => s.done || int(s.r) > 0).map(s => {
      const a = s.add && ADD_WHY[s.a] ? { a: s.a } : {};
      if (x.type === 'time') return { r: int(s.r), ...(s.done && SET_FEEL[s.f] ? { f: s.f } : {}), ...a };
      if (x.type === 'tr') return { t: int(s.w) || it.tt, r: int(s.r), ...(s.done && SET_FEEL[s.f] ? { f: s.f } : {}), ...a };
      const w = Math.abs(num(s.w)) * (x.type === 'bw' && s.neg ? -1 : 1);
      const o = { w: x.type === 'kg' ? num(s.w) : w, r: int(s.r) };
      if (s.done && SET_FEEL[s.f]) o.f = s.f;
      return { ...o, ...a };
    }).filter(s => s.r > 0);
    // ab 3.0 stehen Notizen in der eigenen Tabelle; nur beim Bearbeiten alter Trainings bleibt die alte Notiz im Eintrag
    const en = { exId: x.id, name: x.name, type: x.type, sets, note: draft.edit ? (it.note || '').trim() : '', feel: '' };
    if (it.rm && it.rm.length) en.rm = it.rm.slice();
    if (x.type === 'tr') en.tt = it.tt;
    if (it.swappedFrom && it.swappedFrom.id !== x.id) en.from = { id: it.swappedFrom.id, name: it.swappedFrom.name };
    return en;
  }).filter(en => en.sets.length || en.note);
}
function sheet(inner) { $('#modal').innerHTML = `<div class="backdrop" data-act="mclose-bg"><div class="sheet" role="dialog" aria-modal="true">${inner}</div></div>`; }
function finishSheet() {
  const entries = collectEntries();
  const sets = entries.reduce((a, en) => a + en.sets.length, 0);
  const vol = entries.filter(en => en.type === 'kg').reduce((a, en) => a + en.sets.reduce((b, s) => b + s.w * s.r, 0), 0);
  const empty = draft.items.filter(it => !it.removed && !entries.some(en => en.exId === it.ex.id)).map(it => it.ex.name);
  const { plan } = plannedSets(), open = draft.items.filter(it => !(it.removed && !hasEntries(it))).map(it => ({ name: it.ex.name, done: it.sets.filter(x => x.done || int(x.r) > 0).length, n: it.sets.length })).filter(o => o.done < o.n);
  const abort = sets < plan;
  sheet(`<h2>${abort ? 'Training beenden?' : 'Training abschließen?'}</h2>
    <dl class="kv"><dt>Sätze</dt><dd class="${abort ? 'warn' : ''}">${abort ? `${sets} von ${plan}` : sets}</dd><dt>Volumen</dt><dd>${fmtN(Math.round(vol))} kg</dd><dt>Dauer</dt><dd>${duration(draft.start, new Date().toISOString())}</dd></dl>
    ${abort ? `<div class="abortbox"><span class="eyebrow">Noch ${plan - sets} ${plan - sets === 1 ? 'Satz' : 'Sätze'} offen</span><div class="openlist">${open.map(o => `<div><span>${esc(o.name)}</span><span>${o.done} von ${o.n}</span></div>`).join('')}</div></div>
      <div class="small muted">Wird als abgebrochen gespeichert. Für deine Flammen zählt es ganz normal. Offene Übungen rechnen beim nächsten Mal mit dem letzten vollständigen Training weiter.</div>` : (empty.length ? `<div class="small muted">Ohne Eintrag: ${esc(empty.join(', '))}</div>` : '')}
    ${sets ? '' : '<div class="err">Trage mindestens einen Satz ein.</div>'}
    <div class="btnrow"><button class="btn primary" data-act="finish-yes" ${sets ? '' : 'disabled'}>Speichern</button><button class="btn ghost" data-act="mclose">Weiter trainieren</button></div>`);
}
function discardSheet() {
  sheet(`<h2>Training verwerfen?</h2><p class="muted" style="margin:0">Alle Einträge dieses Trainings gehen verloren. Deine Rotation bleibt unverändert.</p>
    <div class="btnrow"><button class="btn danger" data-act="discard-yes">Verwerfen</button><button class="btn ghost" data-act="mclose">Abbrechen</button></div>`);
}
// Geplante Sätze dieses Trainings (mit + / − Satz angepasst). Weniger erledigte Sätze = abgebrochen.
function plannedSets() {
  let plan = 0, done = 0;
  draft.items.forEach(it => { if (it.removed && !hasEntries(it)) return; plan += it.sets.length; done += it.sets.filter(x => x.done || int(x.r) > 0).length; });
  return { plan, done };
}
function finishTraining() {
  if (TIMER) tmrStop();
  const entries = collectEntries();
  if (!entries.some(en => en.sets.length)) return;
  const end = new Date().toISOString();
  const n = entries.reduce((a, en) => a + en.sets.length, 0);
  const swaps = draft.items.filter(it => it.swappedFrom).map(it => ({ fromId: it.swappedFrom.id, fromName: it.swappedFrom.name, toId: it.ex.id, toName: it.ex.name }));
  const summary = `${dl(draft.day, null, draft.plan)} ${draft.title}${draft.deload ? ' (Deload)' : ''} · ${n} Sätze · ` + entries.map(en => `${en.name}: ${fmtSets(en.type, en.sets)}${feelText(en) ? ` [${feelText(en)}]` : ''}${en.note ? ` (Notiz: ${en.note})` : ''}`).join(' | ');
  const { plan } = plannedSets();
  const k = draft.plan === 'mine' ? 'mine' : 'crew';
  endPauseToday();
  const e = addEvent('workout', { day: draft.day, plan: k, date: todayStr(), short: dl(draft.day, null, k), title: draft.title, start: draft.start, end, deload: !!draft.deload, deloadSkipped: !!draft.deloadSkipped, swaps, entries, plan }, summary + (n < plan ? ` · abgebrochen (${n} von ${plan} Sätzen)` : ''));
  // Notizen aus dem Training: privat und (im Crew-Plan) für die Crew
  draft.items.forEach(it => {
    const base = { plan: k, exId: it.ex.id, day: draft.day, workoutId: e.id, ts: end };
    if ((it.note || '').trim()) addNote({ ...base, scope: 'private', body: it.note });
    if (k === 'crew' && (it.cnote || '').trim()) addNote({ ...base, scope: 'crew', body: it.cnote });
  });
  draft = null; saveDraft(); $('#modal').innerHTML = ''; notesSync();
  const imp = improvements(e);
  if (imp.length) toast(`${imp.length} ${imp.length === 1 ? 'Steigerung' : 'Steigerungen'} gespeichert`);
  location.hash = '#geschafft:' + e.id;
}
function applyToDraft(plan) {
  const old = draft.items, used = new Set(), res = [];
  plan.exercises.forEach(x => {
    let it = old.find(t => !used.has(t) && !t.swappedFrom && t.ex.id === x.id) || old.find(t => !used.has(t) && t.swappedFrom && t.swappedFrom.id === x.id);
    if (it) {
      used.add(it);
      if (!it.swappedFrom) it.ex = clone(x);
      const target = draft.deload ? Math.ceil(x.sets / 2) : x.sets;
      while (it.sets.length < target) { const l = it.sets[it.sets.length - 1]; it.sets.push(blankSet(null, { w: l ? l.w : '', neg: l ? l.neg : false, alt: l ? l.alt || '' : '' })); }
      it.removed = false; res.push(it);
    } else res.push(newItem(clone(x), draft.deload));
  });
  old.forEach((t, i) => {
    if (used.has(t) || !hasEntries(t)) return;
    t.removed = true;
    let pos = 0;
    for (let j = i - 1; j >= 0; j--) { const k = res.indexOf(old[j]); if (k >= 0) { pos = k + 1; break; } }
    res.splice(pos, 0, t);
  });
  draft.items = res; draft.title = plan.title; saveDraft();
}
function swapForm(i, keep) {
  const it = draft.items[i], x = it.ex;
  if (!keep || !PK || PK.ctx !== 'swap') PK = { ctx: 'swap', i, x, day: draft.day, sel: '', q: '', group: 'Passend', exclude: new Set([x.id, ...(it.swappedFrom ? [it.swappedFrom.id] : [])]), vals: null };
  PK.reopen = () => swapForm(i, true);
  PK.onSel = L => { const r = isTimed(L.type) !== isTimed(x.type); if (r || isTimed(L.type)) { $('#sw-min').value = L.min; $('#sw-max').value = L.max; } $('#sw-unit').textContent = isTimed(L.type) ? 'Sek. von' : 'Wdh. von'; };
  const v = (k, d) => esc(pkVal(k, d));
  $('#modal').innerHTML = `<div class="backdrop" data-act="mclose-bg"><form class="sheet full form tone-${DAY_TONE[draft.day]}" id="swapform" data-i="${i}" novalidate>
    ${sheetHead(`${esc(dl(draft.day, null, draft.plan))} · ${esc(x.name)}`, 'Heute tauschen')}
    <h2>Heute tauschen</h2>
    <p class="help" style="margin:0">Ersetzt <b>${esc(x.name)}</b> nur in diesem Training. Dein Plan bleibt unverändert, die Ersatzübung bekommt ihren eigenen Verlauf.</p>
    ${pickBlock('Ersatzübung suchen')}
    <div class="grid3"><label>Sätze<input class="inp" id="sw-sets" name="sets" inputmode="numeric" value="${v('sets', x.sets)}"></label><label><span id="sw-unit">${isTimed(x.type) ? 'Sek. von' : 'Wdh. von'}</span><input class="inp" id="sw-min" name="min" inputmode="numeric" value="${v('min', x.min)}"></label><label>bis<input class="inp" id="sw-max" name="max" inputmode="numeric" value="${v('max', x.max)}"></label></div>
    ${draft.plan !== 'mine' && crewMates().length ? `<fieldset class="radios"><legend>Für wen?</legend>
      <label class="chk"><input type="radio" name="who" value="both" ${pkVal('who', 'both') === 'both' ? 'checked' : ''}><span>Für die ganze Crew heute<small>Deine Crew sieht den Tausch im heutigen Training für ${esc(dl(draft.day, null, draft.plan))}.</small></span></label>
      <label class="chk"><input type="radio" name="who" value="me" ${pkVal('who', 'both') === 'me' ? 'checked' : ''}><span>Nur für mich</span></label>
    </fieldset>` : ''}
    <div class="err" id="sw-err" hidden></div>
    <div class="sbar"><button class="btn primary" type="submit">Tauschen</button></div>
  </form></div>`;
  renderPick();
}
// mode: 'carry' = eingetragene Werte zur neuen Übung mitnehmen und die alte ersetzen, 'both' = beide behalten
function doSwap(i, x, from, by, shared, mode) {
  if (TIMER) tmrStop();
  const it = draft.items[i];
  const ni = newItem(x, draft.deload); ni.swappedFrom = from; ni.swapBy = by;
  if (mode === 'carry') {
    const done = it.sets.map(z => convDSet(it.ex.type, x.type, z));
    ni.sets = done.concat(ni.sets.slice(done.length));
    ni.note = it.note || ''; ni.feel = it.feel || ''; ni.rm = (it.rm || []).slice();
  }
  if (hasEntries(it) && mode !== 'carry') draft.items.splice(i + 1, 0, ni); else draft.items.splice(i, 1, ni);
  saveDraft();
  if (shared) addEvent('swap', { day: draft.day, date: todayStr(), fromId: from.id, fromName: from.name, to: x }, `${dl(draft.day, null, draft.plan)}: ${from.name} heute durch ${x.name} ersetzt (für beide)`);
}
function submitSwap(form) {
  const f = new FormData(form), i = +form.dataset.i, it = draft.items[i];
  const err = m => { const e = $('#sw-err'); e.textContent = m; e.hidden = false; };
  const L = libGet(PK && PK.sel);
  const sets = int(f.get('sets')), min = int(f.get('min')), max = int(f.get('max'));
  if (!L) return err('Bitte wähle die Ersatzübung aus der Bibliothek oder erstelle eine neue.');
  if (!sets || sets > 10 || !min || !max || min > max) return err('Bitte prüfe Sätze und Spanne.');
  const from = it.swappedFrom || { id: it.ex.id, name: it.ex.name };
  if (L.id === it.ex.id || L.id === from.id) return err('Das ist dieselbe Übung.');
  const x = exFromLib(L, { sets, min, max }), shared = f.get('who') === 'both';
  if (hasEntries(it)) { swapAsk(i, x, from, shared); return; }
  PK = null; $('#modal').innerHTML = '';
  doSwap(i, x, from, cfg.me, shared);
  render();
  toast(shared ? 'Getauscht. Deine Crew sieht den Tausch.' : 'Getauscht');
}
// Bei der alten Übung stehen schon Werte: mitnehmen oder beide behalten?
let SWAPQ = null;
function swapAsk(i, x, from, shared) {
  const it = draft.items[i], tn = DAY_TONE[draft.day];
  SWAPQ = { i, x, from, shared };
  const sets = it.sets.filter(z => z.done || int(z.r) > 0).map(z => `<span class="mono">${it.ex.type === 'kg' && num(z.w) ? fmtN(num(z.w)) + ' kg × ' : it.ex.type === 'bw' && num(z.w) ? (z.neg ? '−' : '+') + fmtN(num(z.w)) + ' kg × ' : ''}${it.ex.type === 'time' ? int(z.r) + ' s' : int(z.r) || '–'}</span>`);
  const same = it.ex.type === x.type;
  $('#modal').innerHTML = `<div class="backdrop" data-act="mclose-bg"><div class="sheet swapask t-${tn}" role="dialog" aria-modal="true" aria-label="Werte mitnehmen?">
    <span class="eyebrow">${esc(it.ex.name)} → ${esc(x.name)}</span>
    <h2>Werte mitnehmen?</h2>
    <p class="muted" style="margin:0">${sets.length ? `Bei ${esc(it.ex.name)} ${sets.length === 1 ? 'steht schon 1 Satz' : `stehen schon ${sets.length} Sätze`}: ${sets.join(', ')}.` : `Bei ${esc(it.ex.name)} steht schon eine Notiz.`}</p>
    <button class="btn swq main" data-act="sw-carry"><b>Werte zu ${esc(x.name)} mitnehmen</b><span>${esc(it.ex.name)} fällt aus dem Training. Für dich ist ${esc(x.name)} heute die Übung.</span></button>
    <button class="btn swq" data-act="sw-both"><b>Beide behalten</b><span>Du hast die Sätze wirklich bei ${esc(it.ex.name)} gemacht. ${esc(x.name)} kommt darunter.</span></button>
    <span class="small muted">${same ? 'Gewicht und Wiederholungen werden übernommen.' : 'Andere Übungsart: Das Gewicht wird nicht übernommen, nur die Wiederholungen.'}</span>
    <button class="lnk" data-act="sw-back" style="align-self:center">Zurück zur Auswahl</button>
  </div></div>`;
}
function swapDo(mode) {
  const q = SWAPQ; if (!q || !draft) return;
  SWAPQ = null; PK = null; $('#modal').innerHTML = '';
  doSwap(q.i, q.x, q.from, cfg.me, q.shared, mode);
  render();
  toast((mode === 'carry' ? 'Getauscht, Werte übernommen.' : 'Getauscht, beide bleiben.') + (q.shared ? ' Deine Crew sieht den Tausch.' : ''));
}

/* ---------- Übungsauswahl: überall dieselbe (Plan, Heute tauschen, Training bearbeiten, Zusammenführen) ---------- */
let PK = null;   // { ctx, x, day, sel, q, group, exclude, type, onSel, reopen, vals }
const libAll = () => Object.values(st().lib).filter(L => !L.del && !L.into);
const libVisible = () => libAll().filter(L => !L.hidden);
const libGet = id => { const lib = st().lib; const L = lib[libTarget(lib, id)]; return L && !L.del ? L : null; };
const libGroups = withMatch => [...(withMatch ? ['Passend'] : []), 'Alle', 'Kondition', ...Object.keys(BODY.groups)];
const inGroupL = (L, g) => g === 'Alle' || (g === 'Kondition' ? L.kond : !!BODY.groups[g] && L.p.some(k => BODY.groups[g].includes(k)));
const searchNorm = v => String(v || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();
const libText = L => searchNorm(L.name) + ' ' + L.id.replace(/-/g, ' ') + ' ' + searchNorm(L.syn);
function libSearch(q, group, x, o = {}) {
  const toks = searchNorm(q).split(' ').filter(Boolean);
  let list = (o.hidden ? libAll() : libVisible()).filter(L => !(o.exclude && o.exclude.has(L.id)) && (!o.type || L.type === o.type) && toks.every(t => libText(L).includes(t)));
  if (group === 'Passend' && x) {
    const P = new Set(musOf(x).p);
    return list.map(L => ({ L, sc: L.p.filter(k => P.has(k)).length })).filter(v => v.sc > 0 && v.L.id !== x.id).sort((a, b) => b.sc - a.sc || a.L.name.localeCompare(b.L.name, 'de')).map(v => v.L);
  }
  const byOwn = (a, b) => (b.owner === cfg.me) - (a.owner === cfg.me) || a.name.localeCompare(b.name, 'de');
  if (group === 'Ausgeblendet') return libAll().filter(L => L.hidden && toks.every(t => libText(L).includes(t))).sort(byOwn);
  if (group === 'Eigene') return list.filter(L => L.owner === cfg.me).sort(byOwn);
  return list.filter(L => inGroupL(L, group)).sort(byOwn);
}
function libItem(L, tk, act, sel) {
  const m = { p: L.p, s: L.s };
  const own = L.owner === cfg.me;
  return `<button type="button" role="option" class="sugitem ${sel ? 'sel' : ''} ${own ? 'own' : ''}" data-act="${act}" data-id="${esc(L.id)}" aria-selected="${!!sel}">${bodyFig(bestView(m), tk, m, { w: 22, nums: false })}<span class="sgt"><b>${own ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="Eigene Übung"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>` : ''}${esc(L.name)}</b><span>${esc(m.p.map(k => BODY.names[k][0]).join(', ') || 'Noch keine Muskeln')}</span></span><span class="tp">${sel ? 'Ändern' : TYPE_LABEL[L.type]}</span></button>`;
}
const pickBlock = label => `<label>${label}<span class="swsearch">${ICON.search}<input class="inp" id="pk-q" value="${esc(PK.q || '')}" maxlength="60" autocomplete="off" placeholder="z. B. Beinpresse, Burpees"></span></label><div id="pk-sug" class="sug"></div>`;
function renderPick() {
  const box = $('#pk-sug'); if (!box || !PK) return;
  const tk = DAY_TONE[PK.day] || 'y';
  if (PK.sel) { const L = libGet(PK.sel); if (L) { box.innerHTML = `<div class="suglist">${libItem(L, tk, 'pk-clear', true)}</div>`; return; } PK.sel = ''; }
  const groups = libGroups(!!PK.x);
  if (!groups.includes(PK.group)) PK.group = groups[0];
  const q = PK.q || '';
  let hits = libSearch(q, PK.group, PK.x, PK), label = PK.group === 'Passend' ? `Gleiche Hauptmuskeln wie ${PK.x.name}` : PK.group === 'Alle' ? 'Alle Übungen' : PK.group === 'Kondition' ? 'Ganzkörper / Kondition' : PK.group;
  if (q.trim() && !hits.length && PK.group !== 'Alle') { hits = libSearch(q, 'Alle', PK.x, PK); label = 'Treffer in der Bibliothek'; }
  const chips = `<div class="chips scroll" role="group" aria-label="Nach Muskelgruppe filtern">${groups.map(g => `<button type="button" class="pchip ${g === PK.group ? 'tonep' : ''}" data-act="pk-g" data-v="${g}" aria-pressed="${g === PK.group}">${g}</button>`).join('')}</div>`;
  box.innerHTML = chips + `<div class="eyebrow" style="margin:4px 2px 0">${esc(label)} · ${hits.length}</div>
    <div class="suglist" role="listbox" aria-label="${esc(label)}">${hits.slice(0, 40).map(L => libItem(L, tk, 'pk-pick')).join('')}
    ${PK.ctx === 'merge' ? '' : `<button type="button" class="sugitem new" data-act="pk-new"><span class="plus">+</span><span class="sgt"><b>${q.trim() ? `„${esc(q.trim())}“ als neue Übung erstellen` : 'Neue Übung erstellen'}</b><span>${hits.length ? 'Nicht dabei? Name, Art und Muskeln festlegen' : 'Nichts gefunden. Name, Art und Muskeln festlegen'}</span></span></button>`}</div>`;
  const on = box.querySelector('.chips.scroll .pchip[aria-pressed="true"]'); if (on) on.parentElement.scrollLeft = Math.max(0, on.offsetLeft - 16);
}
// Werte des offenen Formulars merken, bevor eine neue Übung erstellt wird
function pkKeep() { const f = $('#modal form'); if (!f || !PK) return; PK.vals = {}; new FormData(f).forEach((v, k) => { PK.vals[k] = v; }); f.querySelectorAll('input[type=checkbox]').forEach(c => { PK.vals[c.name] = c.checked ? 'on' : ''; }); }
const pkVal = (k, d) => (PK && PK.vals && PK.vals[k] != null ? PK.vals[k] : d);
// Übung aus der Bibliothek für Plan oder Training: Sätze und Spanne aus dem eigenen Plan, sonst Standard der Bibliothek
function exFromLib(L, extra = {}) {
  const def = PEOPLE.flatMap(p => [planOf(p, 'mine'), planOf(p)].flatMap(pl => PD(pl).flatMap(d => pl[d].exercises))).find(y => y.id === L.id);
  return cleanEx({ id: L.id, name: L.name, type: L.type, sets: def ? def.sets : L.sets, min: def ? def.min : L.min, max: def ? def.max : L.max, step: isTimed(L.type) ? 0 : def ? def.step : 2.5, warmup: false, muscles: { p: L.p, s: L.s }, cue: L.cue, video: L.video, ...extra });
}
// Übung ist irgendwo in Gebrauch (Verlauf, Pläne): dann nur ausblenden statt löschen und die Art bleibt fest
const libUsed = id => PEOPLE.some(p => (st().hist[p][id] || []).length || [planOf(p, 'mine'), planOf(p)].some(pl => PD(pl).some(d => pl[d].exercises.some(x => x.id === id))));
const libHasHist = id => PEOPLE.some(p => (st().hist[p][id] || []).length);

/* ---------- Bibliothek (ab 3.0) ----------
   Der Grundbestand ist fest und für niemanden änderbar. Eigene Übungen liegen in der Tabelle „library“ mit owner = ich,
   sichtbar für mich und meine Crew. Offline zuerst: Änderungen stehen sofort in libSheet und gehen über LIBQ an die Datenbank. */
const libOwn = id => { const L = libGet(id); return !!(L && L.owner && L.owner === cfg.me); };
let LIBQ = (() => { const v = LS.get('lib.q', []); return Array.isArray(v) ? v : []; })();
function libDbData(L) {
  // „name“ zusätzlich klein: die Prüfung in der Datenbank (Sperrliste, doppelte Namen) liest dieses Feld
  return { 'ID': L.id, 'Name': L.name, name: L.name, 'Art': TYPE_LABEL[L.type], 'Gruppe': L.kond ? 'Kondition' : '', 'Hauptmuskeln': L.p.map(k => BODY.names[k][0]).join('; '), 'Nebenmuskeln': L.s.map(k => BODY.names[k][0]).join('; '),
    'Sätze': L.sets, 'Spanne von': L.min, 'Spanne bis': L.max, 'Ausführung': L.cue || '', 'Video': L.video || '', 'Suchbegriffe': L.syn || '', 'Ausgeblendet': !!L.hidden, 'Zusammengeführt in': L.into || '', 'Geändert am': new Date().toISOString(), 'Geändert von': pname(cfg.me) };
}
function libApplyRow(row) {
  libSheet = (Array.isArray(libSheet) ? libSheet : []).filter(r => r.id !== row.id);
  if (!row.deleted) libSheet.push(libDbRow(row));
  LS.set('lib.sheet', libSheet); invalidate();
}
function libSaveOwn(rec) {
  const L = cleanLib(rec);
  const row = { id: L.id, owner: cfg.me, crew_id: hasCrew() ? CREW.id : null, data: libDbData(L), deleted: !!L.del };
  LIBQ = LIBQ.filter(q => q.id !== L.id).concat([row]); LS.set('lib.q', LIBQ);
  libApplyRow(row); libPush();
  return L.id;
}
let libPushing = null;
function libPush() {
  if (libPushing || !LIBQ.length || cfg.key !== 'supabase' || navigator.onLine === false) return libPushing || Promise.resolve();
  libPushing = (async () => {
    try {
      for (const row of LIBQ.slice()) {
        const r = await sb.from('library').upsert(row, { onConflict: 'id' });
        if (r.error) { const c = sbErr(r.error); if (c.code === 'network') return; toast(/Bibliothek/.test(c.msg || '') ? 'Diese Übung gibt es schon in der Bibliothek.' : /anderen Namen/.test(c.msg || '') ? 'Bitte wähle einen anderen Namen.' : 'Übung nicht gespeichert'); }
        LIBQ = LIBQ.filter(q => q !== row); LS.set('lib.q', LIBQ);
      }
    } finally { libPushing = null; }
  })();
  return libPushing;
}
// Eigene Übung als Vorschlag für den Grundbestand: landet als Feedback beim Betreiber
async function libSuggest(id) {
  const L = libGet(id); if (!L) return;
  const text = `Vorschlag für die Bibliothek: ${L.name} (${TYPE_LABEL[L.type]}, ${L.sets} × ${L.min}–${L.max})\nHaupt: ${L.p.map(k => BODY.names[k][0]).join(', ') || '–'}\nNeben: ${L.s.map(k => BODY.names[k][0]).join(', ') || '–'}\nAusführung: ${L.cue || '–'}${L.video ? '\nVideo: ' + L.video : ''}\nKennung: ${L.id}`;
  const r = await sb.from('feedback').insert({ kind: 'uebung', text: text.slice(0, 4000), app_version: APP_VERSION, platform: /iPhone|iPad/.test(navigator.userAgent) ? 'iOS' : 'Web' });
  toast(r.error ? 'Vorschlag nicht gesendet. Bitte später noch einmal.' : 'Danke! Dein Vorschlag ist angekommen.');
}
// Übung aus dem Grundbestand (oder eine Crew-Übung) ansehen, mit „Als Vorlage nutzen“
function libView(L, opts = {}) {
  const tk = opts.tk || 'y', timed = isTimed(L.type);
  LF = { id: L.id, tk, opts, view: true };
  $('#modal').innerHTML = `<div class="backdrop" data-act="mclose-bg"><div class="sheet full form tone-${tk}" role="dialog" aria-modal="true">
    ${sheetHead(L.owner ? 'Übung deiner Crew' : 'Bibliothek', esc(L.name))}
    <h2>${esc(L.name)}</h2>
    <div class="ro"><span class="eyebrow">Art</span><div class="rotag"><span class="tag kgtag" style="margin:0">${TYPE_LABEL[L.type]}</span><span class="tag" style="margin:0">Standard ${L.sets} × ${L.min}–${L.max}${timed ? ' s' : ''}</span>${L.kond ? '<span class="tag" style="margin:0">Kondition</span>' : ''}</div></div>
    <div class="musform"><span class="eyebrow">Muskeln</span>${musPreview({ p: L.p, s: L.s }, tk)}</div>
    ${L.cue ? `<div class="ro"><span class="eyebrow">Ausführung</span><p style="margin:0">${esc(L.cue)}</p></div>` : ''}
    <div class="ro"><span class="eyebrow">Video</span><a class="vlink" href="${esc(videoUrl(L))}" target="_blank" rel="noopener">▶ ${L.video ? 'Video ansehen' : 'Shorts auf YouTube'}</a></div>
    <div class="sbar"><button class="btn primary" type="button" data-act="lib-tpl" data-id="${esc(L.id)}">${ICON.copy || ''}Als Vorlage nutzen</button></div>
  </div></div>`;
}
const libSig = L => JSON.stringify([L.type, L.p.slice().sort(), L.s.slice().sort(), !!L.kond, +L.sets, +L.min, +L.max, (L.cue || '').trim(), (L.video || '').trim(), (L.syn || '').trim()]);
// Formularwerte als Übung (für den Vergleich mit der Vorlage)
function lfRead(form) {
  const f = new FormData(form);
  let m; try { m = cleanMuscles(JSON.parse(f.get('muscles') || 'null')) || { p: [], s: [] }; } catch (e) { m = { p: [], s: [] }; }
  return { name: String(f.get('name') || '').trim(), type: TYPE_LABEL[f.get('type')] ? f.get('type') : (LF && LF.lockType) || 'kg', p: m.p, s: m.s, kond: f.get('kond') === 'on', sets: int(f.get('sets')), min: int(f.get('min')), max: int(f.get('max')), cue: String(f.get('cue') || '').trim(), video: String(f.get('video') || '').trim(), syn: String(f.get('syn') || '').trim() };
}
// Mit Vorlage: speichern erst, wenn sich mehr als der Name geändert hat
function lfCheck() {
  const form = $('#libform'); if (!form || !LF || !LF.tpl) return;
  const same = libSig(cleanLib({ ...lfRead(form), id: 'x' })) === LF.tpl;
  const b = form.querySelector('.sbar .btn.primary'), w = form.querySelector('.sbar .why');
  if (b) { b.disabled = same; b.style.opacity = same ? '.4' : ''; }
  if (w) w.hidden = !same;
}

/* ---------- Eigene Übung erstellen oder bearbeiten ---------- */
let LF = null;   // { id, tk, opts, tpl }
function libForm(L, opts = {}) {
  if (L && L.owner !== cfg.me) { libView(L, opts); return; }   // Grundbestand und Crew-Übungen: nur ansehen
  const tpl = opts.tpl ? libGet(opts.tpl) : null;
  const isNew = !L;
  const x = L || (tpl ? cleanLib({ ...tpl, id: 'neu', owner: null, hidden: false, into: '' }) : cleanLib({ id: 'neu', name: opts.name || '', type: opts.type || 'kg' }));
  if (isNew && !tpl) x.name = (opts.name || '').trim();
  const tk = opts.tk || (builder && DAY_TONE[builder.day]) || (L && DAY_TONE[exerciseDay(L.id)]) || 'y';
  const lockType = !isNew && libHasHist(x.id);
  LF = { id: isNew ? '' : x.id, tk, opts, tpl: tpl ? libSig(tpl) : null, lockType: lockType ? x.type : null };
  const used = !isNew && libUsed(x.id);
  const merged = isNew ? [] : Object.values(st().lib).filter(y => y.into === x.id && !y.del && y.owner === cfg.me);
  const timed = isTimed(x.type);
  $('#modal').innerHTML = `<div class="backdrop" data-act="mclose-bg"><form class="sheet full form tone-${tk}" id="libform" novalidate>
    ${sheetHead('Eigene Übung', isNew ? 'Neue eigene Übung' : esc(x.name))}
    <h2>${isNew ? 'Eigene Übung' : esc(x.name)}</h2>
    ${tpl ? `<p class="tplchip">${ICON.copy.replace(/18/g, '14')}Vorlage: ${esc(tpl.name)}</p>` : ''}
    <label>Name<input class="inp" id="lf-name" name="name" value="${esc(x.name)}" maxlength="80" required autocomplete="off"></label>
    <div id="lf-sim"></div>
    <fieldset class="radios"><legend>Art</legend><div class="typeseg" role="group" aria-label="Art der Übung">${Object.entries(TYPE_LABEL).map(([k, v]) => `<label class="tsb"><input type="radio" name="type" value="${k}" ${x.type === k ? 'checked' : ''} ${lockType && x.type !== k ? 'disabled' : ''}><span>${v}</span></label>`).join('')}</div>
      ${lockType ? '<span class="help">Die Art bleibt fest, weil es schon Trainings mit dieser Übung gibt. Für eine andere Art lege eine neue Übung an.</span>' : '<span class="help">Gewicht: kg und Wdh. · Körpergewicht: Wdh., optional ± kg · Zeit: Sekunden · Zeit + Wdh.: Wdh. in fester Zeit.</span>'}</fieldset>
    <label class="chk"><input type="checkbox" name="kond" ${x.kond ? 'checked' : ''}><span>Gruppe Kondition<small>Erscheint zusätzlich unter „Kondition“ (z. B. Burpees).</small></span></label>
    <div class="musform"><span class="eyebrow">Muskeln</span>
      <div id="f-mus-prev">${musPreview({ p: x.p, s: x.s }, tk)}</div>
      <input type="hidden" id="f-muscles" name="muscles" value="${esc(JSON.stringify({ p: x.p, s: x.s }))}">
      <button type="button" class="btn small" data-act="mus-edit">Muskeln bearbeiten</button></div>
    <div class="grid3"><label>Sätze<input class="inp" name="sets" inputmode="numeric" value="${x.sets}"></label>
      <label><span id="lf-unit">${timed ? 'Sek. von' : 'Wdh. von'}</span><input class="inp" name="min" inputmode="numeric" value="${x.min}"></label>
      <label>bis<input class="inp" name="max" inputmode="numeric" value="${x.max}"></label></div>
    <span class="help" style="margin-top:-6px">Standard beim Hinzufügen zum Plan.</span>
    <label>Ausführung<textarea name="cue" rows="4" maxlength="1500" placeholder="Worauf es ankommt, z. B. Rücken gerade, langsam absenken">${esc(x.cue)}</textarea></label>
    <label>Video-Link (optional)<input class="inp" name="video" type="url" inputmode="url" value="${esc(x.video)}" placeholder="https://youtube.com/shorts/…"><span class="help">Leer: Die App sucht passende YouTube Shorts.</span></label>
    <label>Suchbegriffe (optional)<input class="inp" name="syn" value="${esc(x.syn)}" maxlength="200" placeholder="z. B. Captain's Chair, Pull-ups"><span class="help">Weitere Namen, unter denen die Suche die Übung findet.</span></label>
    <div class="vis">${ICON_CREW14.replace(/14/g, '18')}<span><b>${hasCrew() ? 'Sichtbar für dich und deine Crew.' : 'Nur für dich sichtbar.'}</b>${hasCrew() ? '' : ' Sobald du in einer Crew bist, kann deine Crew sie auch nutzen.'}</span></div>
    <div class="err" id="lf-err" hidden></div>
    ${isNew ? '' : `<div class="libmore">
      ${merged.length ? `<div class="eyebrow">Zusammengeführt</div>${merged.map(y => `<div class="devrow"><span class="small" style="flex:1">${esc(y.name)}</span><button type="button" class="btn small ghost" data-act="lib-unmerge" data-id="${esc(y.id)}">Trennen</button></div>`).join('')}` : ''}
      <div class="btnrow wrap">
        <button type="button" class="btn small" data-act="lib-suggest" data-id="${esc(x.id)}">Für die Bibliothek vorschlagen</button>
        <button type="button" class="btn small ghost" data-act="lib-merge">Mit anderer Übung zusammenführen</button>
        ${x.hidden ? '<button type="button" class="btn small ghost" data-act="lib-show">Wieder einblenden</button>' : used ? '<button type="button" class="btn small ghost" data-act="lib-hide">Ausblenden</button>' : '<button type="button" class="btn small ghost danger-t" data-act="lib-del">Löschen</button>'}
      </div>
      ${used && !x.hidden ? '<span class="help">Wird in Plänen oder im Verlauf genutzt. Ausblenden versteckt sie in der Auswahl, der Verlauf bleibt.</span>' : ''}
    </div>`}
    <div class="sbar"><span class="why" ${tpl ? '' : 'hidden'}>Ändere mehr als den Namen.</span><button class="btn primary" type="submit">${isNew ? 'Speichern' : 'Speichern'}</button></div>
  </form></div>`;
  libSim(); lfCheck();
  if (isNew) setTimeout(() => { const n = $('#lf-name'); if (n && !n.value) n.focus(); }, 50);
}
// Ähnliche Namen beim Erstellen anzeigen (gegen doppelte Übungen)
function libSim() {
  const box = $('#lf-sim'), n = $('#lf-name'); if (!box || !n) return;
  const q = normName(n.value), toks = q.split(' ').filter(t => t.length > 3);
  if (!toks.length) { box.innerHTML = ''; return; }
  const sim = libVisible().filter(L => L.id !== LF.id).map(L => ({ L, sc: toks.filter(t => libText(L).includes(t)).length + (normName(L.name) === q ? 5 : 0) })).filter(v => v.sc >= Math.min(2, toks.length) || toks.some(t => t.length >= 6 && libText(v.L).includes(t))).sort((a, b) => b.sc - a.sc).slice(0, 4).map(v => v.L);
  box.innerHTML = sim.length ? `<div class="simbox"><span class="eyebrow">Gibt es vielleicht schon</span>${sim.map(L => `<button type="button" class="pchip" data-act="lf-use" data-id="${esc(L.id)}">${esc(L.name)}</button>`).join('')}</div>` : '';
}
function submitLib(form) {
  const err = m => { const e = $('#lf-err'); e.textContent = m; e.hidden = false; e.scrollIntoView({ block: 'center' }); };
  const v = lfRead(form);
  if (!v.name) return err('Bitte gib einen Namen ein.');
  if (!v.sets || v.sets > 10) return err('Sätze: bitte eine Zahl von 1 bis 10.');
  if (!v.min || !v.max || v.min > v.max) return err('Bitte gib eine gültige Spanne an, z. B. 8 bis 12.');
  if (LF.tpl && libSig(cleanLib({ ...v, id: 'x' })) === LF.tpl) return err('Ändere mehr als den Namen. Sonst nimm einfach die Übung aus der Bibliothek.');
  const same = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
  const base = Object.values(st().lib).find(L => !L.owner && !L.del && same(L.name) === same(v.name));
  if (base && base.id !== LF.id) return err(`„${base.name}“ gibt es schon in der Bibliothek. Wähle einen anderen Namen oder nutze sie als Vorlage.`);
  const dup = libVisible().find(L => L.id !== LF.id && same(L.name) === same(v.name));
  if (dup) return err(`„${dup.name}“ gibt es schon. Bitte wähle einen anderen Namen.`);
  const old = LF.id ? st().lib[LF.id] : null;
  const type = old && libHasHist(old.id) ? old.type : v.type;
  const id = LF.id || ((slug(v.name).slice(0, 40) || 'uebung') + '-' + uid().slice(0, 6));
  const rec = { ...(old || {}), ...v, id, type, hidden: old ? old.hidden : false, del: false, into: old ? old.into : '', owner: cfg.me };
  if (old && libSig(cleanLib(rec)) === libSig(old) && old.name === v.name) { libFormDone(id); return; }
  libSaveOwn(rec);
  toast(old ? 'Übung gespeichert' : 'Eigene Übung erstellt');
  libFormDone(id);
}
function libFormDone(id) {
  const o = LF && LF.opts; LF = null;
  if (o && o.done) o.done(id); else { $('#modal').innerHTML = ''; render(); }
}
function libAct(kind) {
  const L = LF && st().lib[LF.id]; if (!L || L.owner !== cfg.me) return;
  if (kind === 'hide') { libSaveOwn({ ...L, hidden: true }); toast('Ausgeblendet. Unter „Ausgeblendet“ wieder einblenden.'); }
  if (kind === 'show') { libSaveOwn({ ...L, hidden: false }); toast('Wieder eingeblendet'); }
  if (kind === 'del') { if (libUsed(L.id)) return; libSaveOwn({ ...L, del: true }); toast('Übung gelöscht'); }
  libFormDone(kind === 'del' ? '' : L.id);
}
// Zusammenführen: Verlauf, Pläne und Notizen der einen Übung zählen danach für die andere
function libMergeForm(id) {
  const L = st().lib[id]; if (!L) return;
  const back = LF; 
  PK = { ctx: 'merge', x: { id: L.id, name: L.name, muscles: { p: L.p, s: L.s } }, day: back ? Object.keys(DAY_TONE).find(d => DAY_TONE[d] === back.tk) : 'A', sel: '', q: '', group: 'Passend', exclude: new Set([id]), type: L.type, src: id, back };
  PK.onSel = () => mergePreview();
  $('#modal').innerHTML = `<div class="backdrop" data-act="mclose-bg"><form class="sheet full form" id="mergeform" novalidate>
    ${sheetHead('Bibliothek · ' + esc(L.name), 'Zusammenführen')}
    <h2>Zusammenführen</h2>
    <p class="help" style="margin:0"><b>${esc(L.name)}</b> geht in der gewählten Übung auf. Trainings, Pläne und Notizen beider Personen zählen danach dort. Lässt sich in der Bibliothek wieder trennen. Nur Übungen derselben Art (${TYPE_LABEL[L.type]}).</p>
    ${pickBlock('Übung, die bleibt')}
    <div id="mg-prev"></div>
    <div class="err" id="mg-err" hidden></div>
    <div class="sbar"><button class="btn primary" type="submit">Zusammenführen</button></div>
  </form></div>`;
  renderPick(); mergePreview();
}
function mergePreview() {
  const box = $('#mg-prev'); if (!box || !PK) return;
  const L = st().lib[PK.src], T = PK.sel && libGet(PK.sel);
  if (!T) { box.innerHTML = ''; return; }
  const n = p => (st().hist[p][L.id] || []).length;
  const plans = PEOPLE.flatMap(p => pdays(p).filter(d => planOf(p)[d].exercises.some(x => x.id === L.id)).map(d => `${p === cfg.me ? 'dein' : gen(pname(p))} ${dl(d, p)}`));
  const notes = PEOPLE.reduce((a, p) => a + (st().hist[p][L.id] || []).filter(h => h.note).length, 0);
  box.innerHTML = `<div class="abortbox"><span class="eyebrow">Wandert zu ${esc(T.name)}</span><div class="openlist">${PEOPLE.map(p => `<div><span>Trainings ${esc(p === cfg.me ? 'von dir' : 'von ' + p)}</span><span>${n(p)}</span></div>`).join('')}<div><span>Pläne</span><span>${esc(plans.join(', ') || 'keine')}</span></div><div><span>Notizen</span><span>${notes}</span></div></div></div>`;
}
function submitMerge() {
  const err = m => { const e = $('#mg-err'); e.textContent = m; e.hidden = false; };
  const L = st().lib[PK.src], T = PK.sel && libGet(PK.sel);
  if (!T) return err('Bitte wähle die Übung, die bleiben soll.');
  if (T.type !== L.type) return err('Nur Übungen derselben Art lassen sich zusammenführen.');
  if (L.owner !== cfg.me) return err('Nur eigene Übungen lassen sich zusammenführen.');
  libSaveOwn({ ...L, into: T.id });
  builder = null; PK = null; LF = null; $('#modal').innerHTML = '';
  toast(`${L.name} ist jetzt Teil von ${T.name}`); render();
}

/* ---------- Bibliothek im Plan-Tab ---------- */
// Fokus in der Notizen-Ansicht endet beim ersten eigenen Scrollen oder Tippen
document.addEventListener('pointerdown', () => { if (NOTE_FOCUS && NOTE_FOCUS.dim && view === 'notizen' && Date.now() - NOTE_FOCUS.t > 300) noteFocusEnd(); }, true);
document.addEventListener('scroll', () => { if (NOTE_FOCUS && view === 'notizen' && Date.now() - NOTE_FOCUS.t > 500) noteFocusEnd(); }, true);
const LIBV = { q: '', group: 'Alle' };
function libListHTML() {
  const anyHidden = libAll().some(L => L.hidden && L.owner === cfg.me);
  const groups = ['Alle', 'Eigene', 'Kondition', ...Object.keys(BODY.groups), ...(anyHidden ? ['Ausgeblendet'] : [])];
  if (!groups.includes(LIBV.group)) LIBV.group = 'Alle';
  const hits = libSearch(LIBV.q, LIBV.group, null, {});
  const own = hits.filter(L => L.owner === cfg.me).length;
  return `<div class="chips scroll" role="group" aria-label="Filter">${groups.map(g => `<button type="button" class="pchip ${g === LIBV.group ? 'tonep' : ''}" data-act="lib-g" data-v="${g}" aria-pressed="${g === LIBV.group}">${g}</button>`).join('')}</div>
    <div class="eyebrow" style="margin:4px 2px 0">${hits.length} ${hits.length === 1 ? 'Übung' : 'Übungen'}${own ? ` · ${own} ${own === 1 ? 'eigene' : 'eigene'}` : ''}</div>
    <div class="suglist">${hits.map(L => libItem(L, 'y', 'lib-open')).join('') || `<div class="empty">${LIBV.group === 'Eigene' ? 'Noch keine eigenen Übungen.' : 'Keine Übung gefunden.'}</div>`}</div>`;
}
function viewLibrary() {
  return `<h1 class="display" style="font-size:30px">Bibliothek</h1>
    <label class="libsearch"><span class="swsearch">${ICON.search}<input class="inp" id="lib-q" value="${esc(LIBV.q)}" autocomplete="off" placeholder="Übung suchen" aria-label="Übung suchen"></span></label>
    <div class="newitem"><button type="button" class="sugitem new" data-act="lib-new"><span class="plus">+</span><span class="sgt"><b>Eigene Übung erstellen</b><span>Leer starten oder eine Übung als Vorlage nehmen</span></span></button></div>
    <div id="lib-list">${libListHTML()}</div>`;
}

/* ---------- Verlauf ---------- */
function viewVerlauf() {
  const seg = `<div class="seg" role="group" aria-label="Ansicht">${[['aktiv', 'Aktivität'], ['uebungen', 'Übungen'], ['kalender', 'Kalender']].map(([k, v]) => `<button data-act="vtab" data-v="${k}" aria-pressed="${verlaufTab === k}">${v}</button>`).join('')}</div>`;
  const s = st(), me = cfg.me, other = partner();
  if (verlaufTab === 'aktiv') return seg + `<section class="card" style="padding:4px 16px">${s.feed.length ? `<div class="feed">${s.feed.map(feedItem).join('')}</div>` : '<div class="empty">Noch keine Einträge. Starte dein erstes Training auf der Startseite.</div>'}</section>`;
  if (verlaufTab === 'kalender') return seg + viewCalendar();
  const inPlan = new Set();
  const row = x => {
    inPlan.add(x.id);
    const a = lastAny(me, x.id), b = lastAny(other, x.id);
    return `<a class="exrow" href="#uebung:${encodeURIComponent(x.id)}"><div class="n"><b>${esc(x.name)}</b><span class="small muted">${TYPE_LABEL[x.type]}${x.personal ? ' · nur ich' : ''}</span></div>
      <div class="vals"><span>${a ? metricLabel(a.type, a.sets) : '–'}</span><span class="r">${b ? metricLabel(b.type, b.sets) : '–'}</span></div><span class="chev">›</span></a>`;
  };
  const vk = curPlan(), vp = planOf(me, vk);
  const days = PD(vp).map(d => `<div class="sec-title"><h2 style="display:flex;gap:8px;align-items:center">${dayChip(d, me, '', vk)} ${esc(vp[d].title)}</h2></div><section class="card" style="padding:4px 16px">${vp[d].exercises.map(row).join('') || '<div class="empty">Keine Übungen</div>'}</section>`).join('');
  const archived = Object.keys(s.exInfo).filter(id => !inPlan.has(id) && (s.hist[me][id] || s.hist[other][id]));
  const legend = `<div class="legend"><span>oben: du</span><span>unten: ${nm(other)}</span><span>· letzte Einheit</span></div>`;
  return seg + legend + days + (archived.length ? `<div class="sec-title"><h2>Archiv</h2></div><div class="small muted" style="margin:0 2px">Ausgetauschte, entfernte oder spontan getauschte Übungen. Ihr Verlauf bleibt erhalten.</div><section class="card" style="padding:4px 16px">${archived.map(id => row({ id, ...s.exInfo[id] })).join('')}</section>` : '');
}
/* Kürzel im Kalender: erster Buchstabe; bei gleichem Buchstaben zwei; bei gleichem Namen Buchstabe + Zahl.
   Wer im Profil selbst ein Kürzel festgelegt hat, behält es. */
function kurzMap() {
  const out = {}, nameOf = p => String(pname(p) || '?').trim() || '?';
  const one = p => nameOf(p).charAt(0).toUpperCase(), two = p => one(p) + (nameOf(p).charAt(1) || '').toLowerCase();
  PEOPLE.forEach(p => { const k = (PROFILES[p] || {}).kurz; if (k) out[p] = k; });
  const taken = new Set(Object.values(out).map(k => k.toUpperCase()));
  const auto = PEOPLE.filter(p => !out[p]), g1 = {};
  auto.forEach(p => (g1[one(p)] = g1[one(p)] || []).push(p));
  Object.entries(g1).forEach(([c, g]) => {
    if (g.length === 1 && !taken.has(c)) { out[g[0]] = c; return; }
    const g2 = {}; g.forEach(p => (g2[two(p)] = g2[two(p)] || []).push(p));
    Object.entries(g2).forEach(([c2, gg]) => { if (gg.length === 1 && c2.length === 2 && !taken.has(c2.toUpperCase())) out[gg[0]] = c2; else gg.forEach((p, i) => { out[p] = c + (i + 1); }); });
  });
  return out;
}
function viewCalendar() {
  const s = st(), first = new Date(cal.y, cal.m, 1), offset = (first.getDay() + 6) % 7, daysIn = new Date(cal.y, cal.m + 1, 0).getDate();
  const map = {}; const add = (k, o) => (map[k] = map[k] || []).push(o);
  s.workouts.forEach(w => add(dateKey(w.ts), { p: w.person, day: w.data.day, kind: w.data.deload ? 'deload' : w.abort ? 'abort' : 'workout', e: w }));
  // Pausen (eigene immer, andere nur geteilte) als schwarze Marke mit Kürzel
  const mFrom = `${cal.y}-${pad2(cal.m + 1)}-01`, mTo = `${cal.y}-${pad2(cal.m + 1)}-${pad2(daysIn)}`;
  PEOPLE.forEach(p => pausesOf(p).forEach(x => { for (let k = x.from < mFrom ? mFrom : x.from; k <= x.to && k <= mTo; k = addDays(k, 1)) add(k, { p, kind: 'pause', z: x }); }));
  const K = kurzMap();
  const today = todayStr();
  let cells = '';
  for (let i = 0; i < offset; i++) cells += '<div class="cd empty"></div>';
  for (let d = 1; d <= daysIn; d++) {
    const k = `${cal.y}-${pad2(cal.m + 1)}-${pad2(d)}`;
    const items = (map[k] || []).sort((a, b) => PEOPLE.indexOf(a.p) - PEOPLE.indexOf(b.p));
    cells += `<button class="cd ${k === today ? 'today' : ''} ${k === cal.sel ? 'sel' : ''}" data-act="calday" data-v="${k}" aria-label="${d}. ${items.length ? items.length + ' Einträge' : 'kein Eintrag'}"><span class="dn">${d}</span><span class="marks">${items.map(o => o.kind === 'pause' ? `<i class="cm pz" title="${nm(o.p)} · Pause">${esc(K[o.p] || '?')}</i>` : `<i class="cm t-${DAY_TONE[o.day]} ${o.kind === 'deload' ? 'dl' : o.kind}" title="${nm(o.p)} · ${esc(dl(o.day, o.p))}">${esc(K[o.p] || '?')}</i>`).join('')}</span></button>`;
  }
  const sel = (map[cal.sel] || []).filter(o => o.e).map(o => o.e).sort((a, b) => b.ts.localeCompare(a.ts));
  const selPz = (map[cal.sel] || []).filter(o => o.kind === 'pause').map(o => {
    const own = o.p === cfg.me, r = own ? pzReason(o.z) : null, n = dayNum(o.z.to) - dayNum(o.z.from) + 1;
    return `<div class="fi"><span class="pz-ic" style="width:34px;height:34px">${ICON[r ? r.icon : 'hourglass']}</span><div><div class="t"><span><b>${own ? 'Du' : nm(o.p)}</b> ${own ? 'machst' : 'macht'} Pause${r ? ' · ' + r.label : ''}</span></div><div class="m">${o.z.from === o.z.to ? pzDate(o.z.from) : `${pzDate(o.z.from)} – ${pzDate(o.z.to)} · ${n} Tage`}</div></div></div>`;
  }).join('');
  const myK = K[cfg.me] || 'M';
  const title = first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  return `<section class="card cal">
      <div class="calnav"><button class="iconbtn" data-act="calmove" data-v="-1" aria-label="Voriger Monat">${ICON.left}</button><b>${title}</b><button class="iconbtn" data-act="calmove" data-v="1" aria-label="Nächster Monat">${ICON.right}</button></div>
      <div class="calgrid">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(w => `<span class="wd">${w}</span>`).join('')}${cells}</div>
      <div class="legend">${DAYS.filter(d => s.workouts.some(w => w.data.day === d)).map(d => `<span class="ln"><i class="cm t-${DAY_TONE[d]}">${esc(myK)}</i>${esc(dl(d))}</span>`).join('')}</div>
      <div class="legend"><span class="ln"><i class="cm t-n abort">${esc(myK)}</i>abgebrochen</span><span class="ln"><i class="cm t-n dl">${esc(myK)}</i>Deload</span><span class="ln"><i class="cm pz">${ICON.hourglass}</i>Pause</span></div>
    </section>
    <div class="sec-title"><h2>${new Date(cal.sel + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</h2></div>
    <section class="card" style="padding:4px 16px">${sel.length || selPz ? `<div class="feed">${selPz}${sel.map(feedItem).join('')}</div>` : '<div class="empty">An diesem Tag hat niemand trainiert.</div>'}</section>`;
}
function chartSvg(series, label) {
  const pts = series.flatMap(sr => sr.points);
  if (!pts.length) return '<div class="empty">Noch keine Daten.</div>';
  const W = 340, H = 170, L = 38, R = 14, T = 16, B = 26;
  const t0 = Math.min(...pts.map(p => p.t)), t1 = Math.max(...pts.map(p => p.t));
  let v0 = Math.min(...pts.map(p => p.v)), v1 = Math.max(...pts.map(p => p.v));
  if (v0 === v1) { v0 -= 2; v1 += 2; }
  const raw = (v1 - v0) / 3, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const stepV = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw) || 10 * mag;
  v0 = Math.floor(v0 / stepV) * stepV; if (pts.every(p => p.v >= 0)) v0 = Math.max(0, v0);
  v1 = Math.ceil(v1 / stepV) * stepV; if (v1 === v0) v1 = v0 + stepV;
  const ticks = Math.round((v1 - v0) / stepV);
  const X = t => t1 === t0 ? (L + W - R) / 2 : L + (t - t0) / (t1 - t0) * (W - L - R);
  const Y = v => T + (1 - (v - v0) / (v1 - v0)) * (H - T - B);
  let g = '';
  for (let k = 0; k <= ticks; k++) {
    const v = v0 + stepV * k;
    g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(255,255,255,.14)" stroke-width="1"/><text x="${L - 6}" y="${Y(v) + 3}" text-anchor="end">${fmtN(v)}</text>`;
  }
  const dlb = t => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  g += `<text x="${L}" y="${H - 6}">${dlb(t0)}</text>${t1 !== t0 ? `<text x="${W - R}" y="${H - 6}" text-anchor="end">${dlb(t1)}</text>` : ''}`;
  series.forEach(sr => {
    if (!sr.points.length) return;
    g += `<polyline fill="none" stroke="${sr.color}" stroke-width="2.5" ${sr.dash ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round" stroke-linecap="round" points="${sr.points.map(p => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ')}"/>`;
    sr.points.forEach((p, i) => { if (p.lab && (i === 0 || sr.points[i - 1].lab !== p.lab)) g += `<text class="plab" x="${X(p.t).toFixed(1)}" y="${(Y(p.v) - 9).toFixed(1)}" text-anchor="middle">${esc(p.lab)}</text>`; });
    sr.points.forEach((p, i) => { const last = i === sr.points.length - 1; g += `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${last ? 4.5 : 3}" fill="${last ? sr.color : '#000'}" stroke="${sr.color}" stroke-width="2"/>`; });
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf ${esc(label)}">${g}</svg>`;
}
const LEG = (dash) => `<svg width="18" height="4" aria-hidden="true"><line x1="0" y1="2" x2="18" y2="2" stroke="#fff" stroke-width="3" ${dash ? 'stroke-dasharray="4 3"' : ''}/></svg>`;
/* ---------- Fortschritt: fairer Vergleich unabhängig von Körpergewicht und Kraftniveau ----------
   Pro Übung der Wert jeder Einheit (geschätzte Maximalkraft, Sekunden oder Wdh. pro Minute) im Verhältnis zum
   Durchschnitt der ersten zwei Einheiten im Zeitraum. Körpergewichtsübungen mit festem Bezugsgewicht. */
const PERIODS = { '4w': ['4 Wochen', 28], '3m': ['3 Monate', 91], all: ['Seit Start', 0] };
let exMode = 'fort', exPeriod = '4w';
function progress(p, id, per, type) {
  const all = normalSessions(p, id).filter(h => h.sets.some(x => int(x.r) > 0));
  if (!all.length) return null;
  const ty = type || all[all.length - 1].type;
  const days = PERIODS[per || exPeriod][1], from = days ? Date.now() - days * 864e5 : 0;
  const hs = all.filter(h => h.type === ty && +new Date(h.ts) >= from);
  if (hs.length < 3) return { n: hs.length, pts: [], pct: null };
  const ref = ty === 'bw' ? bwRef(p, hs[0].ts) : 0;
  const vals = hs.map(h => sessionStrength(h, null, p, ref));
  const base = (vals[0] + vals[1]) / 2;
  if (!(base > 0)) return { n: hs.length, pts: [], pct: null };
  const pts = hs.map((h, i) => ({ t: +new Date(h.ts), v: Math.round((vals[i] / base - 1) * 1000) / 10 }));
  return { n: hs.length, pts, pct: pts[pts.length - 1].v };
}
const fmtPct = v => (v == null ? '–' : `${v > 0.5 ? '+' : v < -0.5 ? '−' : '±'}${fmtN(Math.abs(Math.round(v)))} %`);
const zusLabel = h => { const ss = h.sets.filter(x => int(x.r) > 0); if (!ss.length) return ''; const b = ss.reduce((a, x) => (int(x.r) > int(a.r) ? x : a)); const w = num(b.w); return w ? (w > 0 ? '+' : '−') + fmtN(Math.abs(w)) : ''; };
// Startseite: Fortschritt der letzten 4 Wochen je Trainingstag, Durchschnitt über die gemeinsamen Übungen
function progressCard() {
  const s = st(), me = cfg.me, other = partner();
  const rows = pdays(me).map(d => {
    const ids = s.plans[me][d].exercises.filter(x => !x.personal && (s.plans[other][d] || EMPTY_DAY).exercises.some(y => y.id === x.id)).map(x => x.id);
    const of = p => ids.map(id => progress(p, id, '4w')).filter(r => r && r.pct != null).map(r => r.pct);
    return { d, a: of(me), b: of(other) };
  });
  const all = k => rows.flatMap(r => r[k]);
  if (!all('a').length && !all('b').length) return `<section class="card progcard"><div class="rowbetween"><b>Fortschritt · 4 Wochen</b></div><span class="small muted">Noch zu wenig Daten. Sobald eine gemeinsame Übung drei Trainings in den letzten 4 Wochen hat, vergleicht ihr hier euren Fortschritt in Prozent.</span></section>`;
  const cell = (v, w) => `<span class="pv ${v != null && (w == null || v >= w) ? 'lead' : ''}">${fmtPct(v)}</span>`;
  const line = (label, a, b, bold) => { const A = a.length ? avg(a) : null, B = b.length ? avg(b) : null; return `<div class="prow2 ${bold ? 'tot' : ''}">${label}${cell(A, B)}${cell(B, A)}</div>`; };
  return `<section class="card progcard"><div style="display:flex;flex-direction:column;gap:2px"><b>Fortschritt · 4 Wochen</b><span class="small muted">Durchschnitt eurer gemeinsamen Übungen</span></div>
    <div class="pgrid"><div class="prow2 hd"><span></span><span class="who">${avatar(me, 20)}Du</span><span class="who">${avatar(other, 20)}${nm(other)}</span></div>
      ${rows.map(r => line(dayChip(r.d, me), r.a, r.b)).join('')}${line('<b>Gesamt</b>', all('a'), all('b'), true)}</div>
    <span class="small muted">Steigerung gegenüber dem Anfang des Zeitraums. So vergleicht ihr fair, egal wie schwer oder stark jemand ist.</span></section>`;
}
function viewExercise(id) {
  const s = st(), me = cfg.me, other = partner();
  const L = libGet(id), info = s.exInfo[id];
  if (!info && !L) return '<div class="empty">Diese Übung gibt es nicht.</div>';
  const day = exerciseDay(id);
  const def = [planOf(me, 'mine'), planOf(me), planOf(other)].flatMap(pl => PD(pl).map(d => pl[d].exercises.find(x => x.id === id))).find(Boolean);
  const type = (def && def.type) || (L && L.type) || info.type, name = (L && L.name) || (def && def.name) || info.name;
  const cue = L ? L.cue : def && def.cue, video = (L && L.video) || (def && def.video);
  const sessionsOf = p => normalSessions(p, id, type);
  const absVal = h => type === 'tr' ? score('tr', h.sets) % 1000 : type === 'time' ? Math.max(...h.sets.map(x => int(x.r))) : type === 'kg' ? workW(h.sets) : Math.max(...h.sets.map(x => int(x.r)));
  const absLabel = type === 'tr' ? 'Wiederholungen, bester Satz' : type === 'time' ? 'Längster Satz (Sek.)' : type === 'kg' ? 'Schwerster Satz (kg)' : 'Wiederholungen, bester Satz';
  const fort = exMode === 'fort';
  const prog = { [me]: progress(me, id, exPeriod, type), [other]: progress(other, id, exPeriod, type) };
  const series = [me, other].map(p => ({ p, color: p === me ? '#fff' : 'rgba(255,255,255,.75)', dash: p !== me, points: fort ? (prog[p] ? prog[p].pts : []) : sessionsOf(p).filter(h => h.sets.length).map(h => ({ t: +new Date(h.ts), v: absVal(h), lab: type === 'bw' ? zusLabel(h) : '' })) }));
  const best = p => { const h = sessionsOf(p).filter(x => x.sets.length); if (!h.length) return '–'; const b = h.reduce((a, x) => score(x.type, x.sets) > score(a.type, a.sets) ? x : a); return metricLabel(b.type, b.sets); };
  const card = p => fort
    ? `<span class="val">${prog[p] && prog[p].pct != null ? fmtPct(prog[p].pct) : '–'}</span><span class="eyebrow">${prog[p] && prog[p].pct != null ? PERIODS[exPeriod][0] : prog[p] ? `zu wenig Daten (${prog[p].n} von 3)` : 'noch nicht trainiert'}</span><span class="small muted">Bestwert ${nm(best(p))}</span>`
    : `<span class="val">${nm(best(p))}</span><span class="eyebrow">Bestwert</span>`;
  const basis = type === 'kg' || type === 'bw' ? 'geschätzte Maximalkraft' : type === 'tr' ? 'Wdh. pro Minute' : 'Sekunden';
  const sessLine = h => { const ft = feelText(h); return `<div class="v">${fmtSets(h.type, h.sets)}</div>${ft ? `<div class="small muted">${esc(ft)}</div>` : ''}`; };
  const sessions = [...(s.hist[me][id] || []), ...(s.hist[other][id] || [])].sort((a, b) => b.ts.localeCompare(a.ts));
  return `<div style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;gap:8px;align-items:center">${day ? dayChip(day, me, 'lg') : '<span class="tag" style="margin:0">Archiv</span>'}<span class="mono muted small">${TYPE_LABEL[type]}${def ? ` · ${def.sets}×${def.min}–${def.max}${isTimed(type) ? ' s' : ''}` : ''}</span></div>
      <h1 style="margin:0;font-size:30px;font-weight:700;letter-spacing:-.02em;line-height:1.1">${esc(name)}</h1>
      ${cue ? `<span class="muted" style="font-size:14px;white-space:pre-line">${esc(cue)}</span>` : `<span class="small warn-t">Noch keine Ausführungshinweise hinterlegt.${L ? ` <button class="lnk" data-act="lib-open" data-id="${esc(L.id)}">In der Bibliothek ergänzen</button>` : ''}</span>`}
      ${def && def.image ? `<img src="${esc(def.image)}" alt="${esc(name)}" loading="lazy" style="border-radius:14px">` : ''}
      <a class="vlink" href="${esc(videoUrl({ name, video }))}" target="_blank" rel="noopener">▶ ${video ? 'Video ansehen' : 'Shorts auf YouTube'}</a>
    </div>
    <div class="seg" role="group" aria-label="Ansicht"><button data-act="exmode" data-v="fort" aria-pressed="${fort}">Fortschritt</button><button data-act="exmode" data-v="abs" aria-pressed="${!fort}">Absolut</button></div>
    ${fort ? `<div class="chips" role="group" aria-label="Zeitraum">${Object.entries(PERIODS).map(([k, [l]]) => `<button class="pchip ${k === exPeriod ? 'tonep' : ''}" data-act="exper" data-v="${k}" aria-pressed="${k === exPeriod}">${l}</button>`).join('')}</div>` : ''}
    <div class="stat2">
      <div class="card"><span class="who">${avatar(me, 24)}Du</span>${card(me)}</div>
      <div class="card"><span class="who">${avatar(other, 24)}${nm(other)}</span>${card(other)}</div>
    </div>
    <section class="card chart"><div class="rowbetween"><b>${fort ? 'Fortschritt in %' : absLabel}</b><div class="legend"><span class="ln">${LEG(false)}Du</span><span class="ln">${LEG(true)}${nm(other)}</span></div></div>
      ${chartSvg(series, fort ? 'Fortschritt' : absLabel)}<span class="small muted">${fort ? `Gegenüber den ersten zwei Einheiten im Zeitraum · ${basis} · ohne Deload` : `ohne Deload-Einheiten${type === 'bw' ? ' · Zahl über dem Punkt: Zusatz (+) oder Hilfe (−) in kg' : ''}`}</span></section>
    ${L || def ? `<section class="card musc"><div class="rowbetween"><b>Muskeln</b>${L ? `<button class="lnk" data-act="lib-open" data-id="${esc(L.id)}">Bearbeiten</button>` : ''}</div>${musBlock(def || { id, name, muscles: { p: L.p, s: L.s } }, DAY_TONE[day] || 'y')}</section>` : ''}
    <div class="sec-title"><h2>Alle Einheiten</h2></div>
    <section class="card">${sessions.length ? sessions.map(h => `<div class="sess"><div class="top"><span class="who" style="color:var(--fg)">${h.person === me ? 'Du' : nm(h.person)}</span><span class="mono">${fmtDate(h.ts)}${h.deload ? ' · Deload' : ''}</span></div>
      ${sessLine(h)}${h.note ? `<p class="quote muted">${esc(h.note)}</p>` : ''}</div>`).join('') : '<div class="empty">Noch nicht trainiert.</div>'}</section>`;
}
function workoutNotes(w, en) {
  const ns = liveNotes().filter(n => n.workout_id === w.id && noteEx(n) === en.exId && (n.scope === 'crew' || n.user_id === cfg.me)).sort((a, b) => a.ts.localeCompare(b.ts));
  if (!ns.length) return en.note ? `<p class="quote muted">${esc(en.note)}</p>` : '';
  return ns.map(n => `<p class="quote muted" style="display:flex;gap:6px;align-items:baseline">${n.scope === 'private' ? ICON_LOCK14 : ICON_CREW14}<span>${esc(n.body)}</span></p>`).join('');
}
function viewWorkout(id) {
  const e = st().workouts.find(w => w.id === id);
  if (!e) return '<div class="empty">Training nicht gefunden.</div>';
  const d = e.data, imp = improvements(e);
  return `<div style="display:flex;flex-direction:column;gap:8px"><span class="who">${avatar(e.person, 28)}${e.person === cfg.me ? 'Du' : nm(e.person)}</span>
      <h1 class="kurz" style="font-size:64px;color:${TONE_HEX[DAY_TONE[d.day]]}">${esc(wlabel(e))}</h1><div style="font-size:18px;font-weight:600">${esc(d.title)}</div>
      <div class="mono muted small">${fmtDate(e.ts)}, ${fmtTime(d.start)}–${fmtTime(d.end)} · ${duration(d.start, d.end)}${d.deload ? ' · Deload' : ''}</div>
      ${e.abort ? `<span class="chip" style="align-self:flex-start">Abgebrochen · ${e.abort.done} von ${e.abort.plan} Sätzen</span>` : ''}
      ${(() => { const prs = imp.filter(i => i.pr), rest = imp.filter(i => !i.pr), col = TONE_HEX[DAY_TONE[d.day]];
        return (prs.length ? `<section class="card wrecs" style="border-color:${col}"><span class="wrecs-h" style="color:${col}">${ICON.trophy}${prs.length === 1 ? 'Rekord' : prs.length + ' Rekorde'}</span>${prs.map(i => `<div><span>${esc(i.name)}</span><span class="mono" style="color:${col}">${esc(i.label)}</span></div>`).join('')}</section>` : '')
          + (rest.length ? `<div class="chips">${rest.map(i => `<span class="chip">${esc(i.name)} ${esc(i.label)}</span>`).join('')}</div>` : ''); })()}</div>
    ${d.edited ? `<span class="small muted">Nachträglich bearbeitet${d.editedBy && d.editedBy !== e.person ? ` von ${d.editedBy === cfg.me ? 'dir' : esc(d.editedBy)}` : ''} am ${fmtDate(d.edited)}, ${fmtTime(d.edited)}</span>` : ''}
    <section class="card">${d.entries.map(en => `<a class="sess" href="#uebung:${encodeURIComponent(en.exId)}"><div class="top"><b style="color:var(--fg)">${esc(en.name)}${en.from ? ` <span class="small muted" style="font-weight:400">statt ${esc(en.from.name)}</span>` : ''}</b><span class="mono">${en.sets.length} ${en.sets.length === 1 ? 'Satz' : 'Sätze'}</span></div>
      ${(() => { const ft = feelText(en); return `<div class="v">${fmtSets(en.type, en.sets)}</div>${ft ? `<div class="small muted">${esc(ft)}</div>` : ''}`; })()}${workoutNotes(e, en)}</a>`).join('')}</section>
    ${e.person === cfg.me ? (wDelAsk === e.id
      ? `<section class="card"><b>Training endgültig löschen?</b><span class="small muted">Es verschwindet aus deinem Verlauf, der Statistik und der Rotation, auch bei deinen Buddies.</span><div class="btnrow"><button class="btn small danger" data-act="w-del-yes" data-id="${esc(e.id)}">Löschen</button><button class="btn small ghost" data-act="w-del-no">Abbrechen</button></div></section>`
      : `<div class="btnrow"><button class="btn glass" data-act="w-edit" data-id="${esc(e.id)}">Bearbeiten</button><button class="btn ghost danger-t" data-act="w-del" data-id="${esc(e.id)}">Löschen</button></div>`)
      : ''}`;
}
/* ---------- Abgeschlossenes Training bearbeiten: gleiche Karten und Möglichkeiten wie im Training ----------
   Das Training wird als eigener Entwurf (edraft) geladen. Beim Anzeigen und bei Aktionen tritt er kurz an die Stelle
   des laufenden Trainings, so laufen dieselben Karten und Knöpfe. Ein laufendes Training bleibt davon unberührt. */
let edraft = (() => { const d = LS.get('edraft', null); return d && d.edit && Array.isArray(d.items) ? d : null; })(), wDelAsk = null, devN = 8;
function withEd(fn) { const keep = draft; draft = edraft; try { return fn(); } finally { edraft = draft; draft = keep; } }
function edSetOf(type, x) {
  const base = { done: true, f: SET_FEEL[x.f] ? x.f : '', a: ADD_WHY[x.a] ? x.a : '' };
  if (type === 'time') return blankSet(null, { ...base, r: String(int(x.r) || '') });
  if (type === 'tr') return blankSet(null, { ...base, w: String(int(x.t) || ''), r: String(int(x.r) || '') });
  const w = num(x.w);
  if (type === 'bw') return blankSet(null, { ...base, w: w ? fmtIn(Math.abs(w)) : '', neg: w < 0, r: String(int(x.r) || '') });
  return blankSet(null, { ...base, w: fmtIn(w), r: String(int(x.r) || '') });
}
const edItem = (ex, sets, extra = {}) => ({ ex, note: '', feel: '', wu: [], swappedFrom: null, swapBy: null, removed: false, hint: '', kind: '', sets, tt: ex.type === 'tr' ? ex.min : 0, rm: [], ...extra });
function openEdit(w) {
  const pl = planOf(w.person, w.data.plan)[w.data.day] || EMPTY_DAY;
  const planN = x => (w.data.deload ? Math.ceil((+x.sets || 1) / 2) : +x.sets || 1);
  const items = w.data.entries.map(en => {
    const L = libGet(en.exId), def = pl.exercises.find(y => y.id === en.exId);
    const ex = def ? clone(def) : L ? exFromLib(L) : cleanEx({ id: en.exId, name: en.name, type: en.type });
    ex.type = en.type;
    const sets = en.sets.map(x => edSetOf(en.type, x));
    const n = def ? planN(def) - (en.rm ? en.rm.length : 0) : null;
    sets.forEach((x, j) => { if (x.a || (n != null && j >= n)) x.add = true; });
    if (w.abort && def) for (let j = sets.length; j < n; j++) sets.push(blankSet(null));   // offene Sätze eines abgebrochenen Trainings
    return edItem(ex, sets, { note: en.note || '', feel: en.feel || '', swappedFrom: en.from || null, tt: en.tt || (en.type === 'tr' ? ex.min : 0), rm: (en.rm || []).slice() });
  });
  if (w.abort) pl.exercises.forEach(x => { if (!items.some(it => it.ex.id === x.id || (it.swappedFrom && it.swappedFrom.id === x.id))) items.push(edItem(clone(x), Array.from({ length: planN(x) }, () => blankSet(null)))); });
  edraft = { edit: true, ref: w.id, person: w.person, day: w.data.day, title: w.data.title, start: w.data.start, deload: !!w.data.deload, swapIgnored: [], items };
  LS.set('edraft', edraft);
  location.hash = '#bearbeiten';
}
function viewEdit() {
  const { done, tot } = workCount(), other = draft.person !== cfg.me;
  return `<header class="trainhead" id="head">
      <div class="row"><a class="iconbtn" href="#training-log:${encodeURIComponent(draft.ref)}" aria-label="Zurück ohne Speichern">${ICON.left}</a><span class="count" id="tp-count">${trainCountText()}</span><span style="width:44px"></span></div>
      <div class="ttl"><div><h1 class="kurz">${esc(dl(draft.day, draft.person))}</h1><div class="sub">Bearbeiten · ${other ? nm(draft.person) + ' · ' : ''}${fmtDate(draft.start)}</div></div>${draft.deload ? '<span class="pill dl">Deload</span>' : ''}</div>
      <div class="bar"><i id="tp-bar" style="width:${tot ? done / tot * 100 : 0}%"></i></div>
    </header>
    <main class="view notab">${other ? `<div class="small muted" style="padding:0 4px">${nm(draft.person)} sieht die Änderung in den Neuigkeiten und bekommt einen Hinweis in der Glocke.</div>` : ''}
      ${draft.items.map((it, i) => exCard(it, i)).join('')}
      <button class="btn glass" data-act="ed-addex">${ICON.plus} Übung hinzufügen</button></main>
    <div class="trainbar"><button class="btn primary" data-act="ed-save">Änderungen speichern</button><button class="btn x" data-act="ed-cancel" aria-label="Änderungen verwerfen">${ICON.x}</button></div>`;
}
// Tauschen oder Hinzufügen im Bearbeiten (läuft mit dem Bearbeiten-Entwurf)
function edPickForm(i) {
  const add = i === 'add', it = add ? null : draft.items[i];
  PK = { ctx: 'edit', i, x: it ? it.ex : null, day: draft.day, sel: '', q: '', group: add ? 'Alle' : 'Passend', exclude: new Set(draft.items.map(t => t.ex.id)), vals: null };
  PK.reopen = () => withEd(() => { const keep = PK; edPickForm(i); PK.sel = keep.sel; PK.q = keep.q; PK.vals = keep.vals; renderPick(); });
  $('#modal').innerHTML = `<div class="backdrop" data-act="mclose-bg"><form class="sheet full form tone-${DAY_TONE[draft.day]}" id="edpick" novalidate>
    ${sheetHead(`${draft.person !== cfg.me ? nm(draft.person) + ' · ' : ''}${esc(dl(draft.day, draft.person))} · ${fmtDate(draft.start)}`, add ? 'Übung hinzufügen' : 'Übung tauschen')}
    <h2>${add ? 'Übung hinzufügen' : 'Übung tauschen'}</h2>
    <p class="help" style="margin:0">${add ? 'Für eine Übung, die gemacht, aber nicht eingetragen wurde. Die Sätze danach wie im Training eintragen und abhaken.' : `Ersetzt <b>${esc(it.ex.name)}</b> nur in diesem Training. Der Plan bleibt unverändert. Sätze, Wiederholungen und Bewertungen bleiben, das Gewicht nur bei gleicher Art.`}</p>
    ${pickBlock(add ? 'Übung suchen' : 'Ersatzübung suchen')}
    ${add ? `<label>Sätze<input class="inp" name="sets" inputmode="numeric" value="${esc(pkVal('sets', 3))}"></label>` : ''}
    <div class="err" id="ep-err" hidden></div>
    <div class="sbar"><button class="btn primary" type="submit">${add ? 'Hinzufügen' : 'Tauschen'}</button></div>
  </form></div>`;
  renderPick();
}
// Satzwerte beim Tausch: Wiederholungen und Bewertungen bleiben, Gewicht nur bei gleicher Art, Sekunden zwischen Zeit-Arten
function convDSet(from, to, x) {
  const o = { ...x }; if (from === to) return o;
  const secs = from === 'time' ? x.r : from === 'tr' ? x.w : '', reps = from === 'time' ? '' : x.r;
  Object.assign(o, { neg: false, alt: '', mk: '', lab: '', man: false });
  if (to === 'time') { o.r = secs || ''; o.w = ''; } else if (to === 'tr') { o.w = secs || ''; o.r = reps || ''; } else { o.w = ''; o.r = reps || ''; }
  if (!int(o.r) || to === 'kg' || (to === 'tr' && !int(o.w))) o.done = false;
  return o;
}
function submitEdPick(form) {
  const f = new FormData(form), err = m => { const e = $('#ep-err'); e.textContent = m; e.hidden = false; };
  const L = libGet(PK && PK.sel); if (!L) return err('Bitte wähle eine Übung aus der Bibliothek oder erstelle eine neue.');
  const ex = exFromLib(L);
  if (PK.i === 'add') {
    const n = int(f.get('sets')); if (!n || n > 10) return err('Sätze: bitte eine Zahl von 1 bis 10.');
    draft.items.push(edItem(ex, Array.from({ length: n }, () => blankSet(null))));
  } else {
    const it = draft.items[PK.i]; if (L.id === it.ex.id) return err('Das ist dieselbe Übung.');
    it.sets = it.sets.map(x => convDSet(it.ex.type, ex.type, x));
    if (!it.swappedFrom) it.swappedFrom = { id: it.ex.id, name: it.ex.name };
    if (it.swappedFrom.id === ex.id) it.swappedFrom = null;
    it.ex = ex; it.tt = ex.type === 'tr' ? (it.tt || ex.min) : 0;
  }
  saveDraft(); PK = null; $('#modal').innerHTML = ''; render();
  if (L.type === 'kg' && PK === null) toast('Gewicht eintragen und Sätze abhaken');
}
function saveEdit() {
  const w = st().workouts.find(x => x.id === draft.ref);
  if (!w) { draft = null; LS.set('edraft', null); location.hash = '#verlauf'; return; }
  const kgEmpty = draft.items.find(it => it.ex.type === 'kg' && it.sets.some(x => (x.done || int(x.r) > 0) && !num(x.w)));
  if (kgEmpty) { toast(`${kgEmpty.ex.name}: Gewicht fehlt.`); return; }
  const entries = collectEntries();
  if (!entries.some(en => en.sets.length)) { toast('Trag mindestens einen Satz ein. Ganz löschen geht im Verlauf.'); return; }
  const sig = en => JSON.stringify([en.sets, en.note || '', en.rm || []]);
  const old = w.data.entries;
  const before = JSON.stringify(old.map(en => [en.exId, sig(en)])), after = JSON.stringify(entries.map(en => [en.exId, sig(en)]));
  const ref = w.id; draft = null; LS.set('edraft', null);
  if (before === after) { location.hash = '#training-log:' + ref; return; }
  const oldIds = new Set(old.map(en => en.exId)), newIds = new Set(entries.map(en => en.exId)), chg = [], swapped = new Set();
  entries.forEach(en => { if (oldIds.has(en.exId)) return; if (en.from && oldIds.has(en.from.id) && !newIds.has(en.from.id)) { chg.push(`${en.from.name} → ${en.name}`); swapped.add(en.from.id); } else chg.push(`+ ${en.name}`); });
  old.forEach(en => { if (!newIds.has(en.exId) && !swapped.has(en.exId)) chg.push(`− ${en.name}`); });
  if (entries.some(en => { const o = old.find(x => x.exId === en.exId); return o && sig(o) !== sig(en); })) chg.push('Werte korrigiert');
  addEvent('workout_edit', { ref, entries, chg, ...(w.person !== cfg.me ? { as: w.person } : {}) }, `${w.person !== cfg.me ? `Training von ${pname(w.person)}: ` : ''}${dl(w.data.day, w.person)} vom ${fmtDate(w.ts)} bearbeitet${chg.length ? ` (${chg.join(', ')})` : ''} · ` + entries.map(en => `${en.name}: ${fmtSets(en.type, en.sets)}${en.note ? ` (Notiz: ${en.note})` : ''}`).join(' | '));
  toast(w.person !== cfg.me ? `Gespeichert. ${pname(w.person)} bekommt einen Hinweis.` : 'Training gespeichert');
  location.hash = '#training-log:' + ref;
}
function closeModal() {
  if (LF && LF.opts && LF.opts.cancel && ($('#libform') || LF.view)) { const c = LF.opts.cancel; LF = null; c(); return; }
  if (PK && PK.ctx === 'merge' && PK.back && $('#mergeform')) { const b = PK.back; PK = null; const L = st().lib[b.id]; LF = null; if (L) libForm(L, b.opts); else $('#modal').innerHTML = ''; return; }
  PK = null; LF = null; $('#modal').innerHTML = '';
}
function viewProfile(p) {
  const s = st(), own = p === cfg.me;
  const ws = s.workouts.filter(w => w.person === p);
  const wk = weekStart();
  const counts = DAYS.map(d => ws.filter(w => w.data.day === d).length);   // Tage ohne Training werden unten ausgelassen
  const tot = ws.length;
  const bw = s.bw[p]; let ci = bw.length ? 0 : -1; bw.forEach((b, i) => { if (b.from <= todayStr()) ci = i; });
  const lb = ci >= 0 ? bw[ci] : null, pb = ci > 0 ? bw[ci - 1] : null;
  const since = s.first[p];
  const meta = `${since ? 'Trainiert seit ' + new Date(since).toLocaleDateString('de-DE') : 'Noch keine Einträge'}${own ? ` · als Nächstes ${esc(dl(nextDay(p), p, curPlan()))}` : ''}`;
  const bid = (PROFILES[p] || {}).buddy_id;
  const idLine = own && bid ? `<button data-act="acct-copy" style="background:none;border:0;color:#fff;padding:2px 0;display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:-4px" aria-label="Buddy-ID ${esc(bid)} kopieren"><span class="mono" style="font-size:16px;font-weight:700;letter-spacing:.08em">#${esc(bid)}</span>${ICON.copy.replace(/18/g, '16')}</button>` : '';
  const goal = weekGoal(p), wkN = ws.filter(w => weekOf(w.ts) === weekOf(Date.now())).length, pzD = own ? pauseDaysInWeek(p, weekOf(Date.now())) : 0, eGoal = own ? effGoal(p, weekOf(Date.now())) : goal;
  const ring = `<div class="pf-ring">${avatar(p, 114)}${own ? `<button class="pf-qr" data-act="id-sheet" aria-label="Meinen QR-Code zeigen">${ICON.qr.replace(/20/g, '16')}</button>` : ''}${own ? `<label class="pf-cam" aria-label="Profilbild ändern">${ICON.cam.replace('width="22" height="22"', 'width="16" height="16"')}<input type="file" id="av-file" accept="image/*" hidden></label>` : ''}</div>`;
  const bar = `<section class="card"><div class="rowbetween"><span class="eyebrow">Trainings nach Tag</span><span class="mono muted small">${tot}</span></div>
      <div class="daybar">${tot ? DAYS.map((d, i) => counts[i] ? `<i class="t-${DAY_TONE[d]}" style="flex:${counts[i]}"></i>` : '').join('') : ''}</div>
      <div class="legend mono">${DAYS.map((d, i) => counts[i] || pdays(p).includes(d) ? `<span>${esc(dl(d, p))} ${counts[i]}</span>` : '').join('')}</div></section>`;
  if (own) {
    return `<div class="pf">${ring}<h1 class="display">${nm(p)}</h1>${idLine}<span class="mono muted small">${meta}</span></div>
      <div class="stat2">
        <div class="card"><span class="val">${tot}</span><span class="eyebrow">Trainings</span></div>
        <a class="card" href="#gewicht"><span class="val">${lb ? fmtN(lb.kg) + '<small> kg</small>' : '–'}</span><span class="eyebrow">Körpergewicht${pb ? ` · ${lb.kg - pb.kg >= 0 ? '+' : '−'}${fmtN(Math.abs(lb.kg - pb.kg))}` : ''}</span></a>
      </div>
      <button class="card goalcard" data-act="goal-open"><span style="display:flex;align-items:center;gap:12px">${flameImg(p, 36)}<span style="flex:1;display:flex;flex-direction:column;text-align:left"><b>Wochenziel · ${pzD ? (eGoal ? `${eGoal} ${eGoal === 1 ? 'Training' : 'Trainings'}` : 'eingefroren') : `${goal} ${goal === 1 ? 'Training' : 'Trainings'}`}</b><span class="small muted">${pzD ? `statt ${goal} · ${pzD} ${pzD === 1 ? 'Tag' : 'Tage'} Pause diese Woche` : `${wkN} von ${goal} diese Woche`}${(PROFILES[p] || {}).week_goal_next && new Date((PROFILES[p] || {}).week_goal_from) > new Date() ? ` · ab ${new Date(PROFILES[p].week_goal_from).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}: ${PROFILES[p].week_goal_next}` : ''}</span></span>${ICON.right}</span></button>
      ${bar}
      <a class="vaultcard glass" href="#vault"><span class="ic">${ICON.lock}</span><span style="flex:1;display:flex;flex-direction:column;gap:2px"><b>Vault</b><span class="small muted">${vmeta() ? 'Private Bilder · nur für dich' : 'Private Fortschrittsbilder · Code festlegen'}</span></span>${ICON.right}</a>
      ${galleryHTML()}`;
  }
  const recent = ws.slice().reverse().slice(0, 3);
  return `<div class="pf">${ring}<h1 class="display">${nm(p)}</h1><span class="mono muted small">${meta}${crewMates().includes(p) ? ' · in deiner Crew' : ''}</span></div>
    <div class="stat2">
      <div class="card"><span class="val">${tot}</span><span class="eyebrow">Trainings</span></div>
      <div class="card"><span class="val">${wkN}<small> / ${goal}</small></span><span class="eyebrow">Diese Woche</span></div>
    </div>
    <a class="btn primary" href="#chat:${encodeURIComponent(p)}">Nachricht schreiben</a>
    ${bar}
    ${recent.length ? `<section class="card" style="padding:4px 16px"><div class="feed">${recent.map(feedItem).join('')}</div></section>` : ''}`;
}
async function setAvatar(file) {
  try {
    let q = 0.8, data = '';
    const c = await resizeImage(file, 220, true);
    do { data = c.toDataURL('image/jpeg', q); q -= 0.1; } while (data.length > 40000 && q > 0.3);
    if (data.length > 40000) { toast('Das Bild ist zu groß. Bitte ein anderes wählen.'); return; }
    addEvent('avatar', { img: data }, 'Profilbild aktualisiert');
    toast('Profilbild gespeichert'); render();
  } catch (e) { toast('Das Bild konnte nicht gelesen werden.'); }
}

/* ---------- Vault ---------- */
const PIN_TITLE = { unlock: 'Gib deinen Code ein', set1: 'Lege einen 4-stelligen Code fest', set2: 'Code zur Bestätigung wiederholen', old: 'Aktuellen Code eingeben', new1: 'Neuen 4-stelligen Code eingeben', new2: 'Neuen Code wiederholen', import: 'Code des Backups eingeben' };
function pinPad() {
  const mode = VAULT.mode;
  const dots = [0, 1, 2, 3].map(i => `<i class="${i < VAULT.pin.length ? 'on' : ''}"></i>`).join('');
  const k = n => `<button class="key" data-act="pin" data-v="${n}">${n}</button>`;
  return `<div class="lock"><span class="ic glass">${ICON.lock}</span><h1 class="display" style="font-size:40px">Vault</h1>
    <span class="muted">${PIN_TITLE[mode]}</span>
    <div class="pins ${VAULT.bad ? 'bad' : ''}" aria-label="${VAULT.pin.length} von 4 Ziffern eingegeben">${dots}</div>
    ${VAULT.msg ? `<span class="${/Falsch|stimmen|Zu viele/.test(VAULT.msg) ? 'err' : 'muted'}">${esc(VAULT.msg)}</span>` : ''}
    <div class="pad">${k(1)}${k(2)}${k(3)}${k(4)}${k(5)}${k(6)}${k(7)}${k(8)}${k(9)}<a class="key plain" href="#${mode === 'old' || mode.startsWith('new') ? 'einstellungen' : 'profil'}">Abbrechen</a>${k(0)}<button class="key plain" data-act="pin-del" aria-label="Letzte Ziffer löschen">${ICON.del}</button></div>
    ${mode === 'set1' && !VAULT.restore ? `<a class="lnk" href="#vault-wiederherstellen" style="font-weight:600">Schon einen Vault? Wiederherstellen</a>` : ''}
    <span class="small muted" style="max-width:300px">${VAULT.restore ? `Schlüssel passt. Lege jetzt den Code für dieses Handy fest${VAULT.restore.n ? `, danach werden ${VAULT.restore.n} ${VAULT.restore.n === 1 ? 'Bild' : 'Bilder'} geladen` : ''}.` : mode === 'set1' || mode === 'set2' ? 'Den Code brauchst du bei jedem Öffnen auf diesem Handy.' : 'Nur mit deinem Code lesbar. Niemand sonst sieht deine Bilder.'}</span></div>`;
}
function viewRecoveryKey() {
  return `<div class="lock"><span class="ic glass">${ICON.key}</span><h1 class="display" style="font-size:26px">Dein Wiederherstellungs&shy;schlüssel</h1>
    <span class="muted" style="max-width:330px">Damit holst du deine Bilder auf ein neues Handy. Speichere ihn jetzt an einem sicheren Ort, z. B. in Apple Passwörter oder einer gesperrten Notiz.</span>
    <div class="rkey mono" id="rk-show">${VAULT.showKey.split('-').map(g => `<span>${g}</span>`).join('')}</div>
    <button class="btn glass" data-act="rk-copy" style="min-width:200px">Kopieren</button>
    <button class="btn primary" data-act="rk-done" style="min-width:260px">Ich habe ihn gespeichert</button>
    <span class="small muted" style="max-width:320px">Ohne diesen Schlüssel lassen sich die Bilder bei einem Handywechsel nicht wiederherstellen. Gib ihn niemandem, auch nicht deinen Buddys.</span></div>`;
}
function viewRestore() {
  return `<div class="form">
    <h1 class="display" style="font-size:30px">Vault wieder&shy;herstellen</h1>
    <p class="muted" style="margin:0">Gib deinen Wiederherstellungsschlüssel ein. Danach legst du einen Code für dieses Handy fest und deine Bilder werden aus der Sicherung geladen.</p>
    ${vmeta() ? `<section class="card notice"><b>Ersetzt den Vault auf diesem Handy</b><span class="small">Der jetzige Vault und sein Schlüssel werden ersetzt. Bilder, die du nur darin gespeichert hast, gehen verloren. Die Sicherung in der Tabelle bleibt unangetastet, bis der neue Code festgelegt ist.</span></section>` : ''}
    <label>Wiederherstellungsschlüssel<textarea class="inp mono" id="rk-in" rows="2" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"></textarea></label>
    <div class="err" id="rk-err" hidden></div>
    <button class="btn primary" id="rk-go" data-act="rk-restore">Weiter</button>
  </div>`;
}
function viewVault() {
  if (!vmeta() && !VAULT.importData) { if (VAULT.mode !== 'set2') VAULT.mode = 'set1'; return pinPad(); }
  if (!VAULT.key || VAULT.mode !== 'unlock') return pinPad();
  if (VAULT.showKey) return viewRecoveryKey();
  const list = VAULT.entries || [];
  const items = list.map(e => `<div class="en">
      <div class="rowbetween"><b class="mono" style="font-size:14px">${fmtLong(e.date + 'T12:00')}</b><span class="mono muted small">${relDay(e.date + 'T12:00')}</span></div>
      <div class="photo"><img data-vimg="${esc(e.id)}" alt="Fortschrittsbild vom ${esc(e.date)}">${e.bw ? `<span class="bwtag">${fmtN(e.bw)} kg</span>` : ''}</div>
      ${e.note ? `<p class="quote">${esc(e.note)}</p>` : ''}
      ${VAULT.del === e.id ? `<div class="confirm"><b>Bild endgültig löschen?</b><div class="btnrow"><button class="btn small danger" data-act="v-del-yes" data-id="${esc(e.id)}">Löschen</button><button class="btn small ghost" data-act="v-del-no">Abbrechen</button></div></div>` : `<button class="addset" data-act="v-del" data-id="${esc(e.id)}" style="align-self:flex-start;color:var(--dim)">Löschen</button>`}
    </div>`).join('');
  return `<div class="rowbetween" style="align-items:flex-end"><div style="display:flex;flex-direction:column;gap:6px"><h1 class="display" style="font-size:40px">Vault</h1><span class="mono muted small">${list.length} ${list.length === 1 ? 'Bild' : 'Bilder'}${list.length ? ' · seit ' + new Date(list[list.length - 1].date + 'T12:00').toLocaleDateString('de-DE') : ''}</span></div><a class="btn primary small" href="#vault-neu">${ICON.plus} Foto</a></div>
    ${VAULT.msg ? `<span class="muted small">${esc(VAULT.msg)}</span>` : ''}
    ${list.length ? `<div class="tl">${items}</div>` : `<section class="card"><div class="empty">Noch keine Bilder. Mit „Foto“ legst du dein erstes Fortschrittsbild an. Tipp: gleiche Stelle, gleiches Licht, gleiche Pose.</div></section>`}`;
}
function viewVaultNew() {
  const cur = bwAt(cfg.me, new Date()); const lb = cur == null ? null : { kg: cur };
  return `<form class="form" id="vaultform" novalidate>
    <h1 class="display" style="font-size:30px">Neuer Eintrag</h1>
    <div class="pickphoto glass">${VAULT.photoUrl ? `<img src="${VAULT.photoUrl}" alt="Gewähltes Foto">` : `${ICON.cam}<b>Foto aufnehmen oder auswählen</b><span class="small muted">Tipp: gleiche Stelle, gleiches Licht, gleiche Pose</span>`}
      <input type="file" id="vn-file" accept="image/*" aria-label="Foto aufnehmen oder auswählen"></div>
    <div class="grid2"><label>Datum<input class="inp mono" type="date" id="vn-date" name="date" value="${todayStr()}" max="${todayStr()}"></label>
      <label>Gewicht (kg)<input class="inp mono" id="vn-bw" name="bw" inputmode="decimal" value="${lb ? fmtIn(lb.kg) : ''}" placeholder="optional"></label></div>
    <label>Notiz<textarea id="vn-note" name="note" rows="3" maxlength="2000" placeholder="z. B. Pump nach B&T, Brust oben voller"></textarea></label>
    <div class="err" id="vn-err" hidden></div>
    <button class="btn primary" id="vn-save" type="submit">Im Vault speichern</button>
    <span class="small muted" style="text-align:center">Wird verschlüsselt gespeichert und in deinem Konto gesichert. Lesbar nur mit deinem Schlüssel, sonst sieht es niemand.</span>
  </form>`;
}

/* ---------- Körpergewicht ---------- */
function viewBodyweight() {
  const me = cfg.me, list = st().bw[me];
  const ws = st().workouts.filter(w => w.person === me);
  const pts = list.map(b => ({ t: +new Date(b.from + 'T12:00'), v: b.kg }));
  const fmtD = k => new Date(k + 'T12:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const prevDay = k => { const d = new Date(k + 'T12:00'); d.setDate(d.getDate() - 1); return dateKey(d); };
  const periods = list.map((b, i) => {
    const next = list[i + 1], to = next ? prevDay(next.from) : null;
    const n = ws.filter(w => { const k = dateKey(w.ts); return (i === 0 || k >= b.from) && (!next || k < next.from); }).length;
    const range = i === 0 && list.length > 1 ? `bis ${fmtD(to)}` : next ? `${fmtD(b.from)} – ${fmtD(to)}` : `ab ${fmtD(b.from)}`;
    const note = !next ? 'aktuell' : i === 0 ? 'gilt auch für alle Trainings davor' : '';
    return `<div class="sess"><div class="top"><span class="mono" style="color:var(--fg)">${range}</span><span class="mono" style="color:var(--fg);font-weight:700">${fmtN(b.kg)} kg</span></div><span class="small muted">${[note, `${n} ${n === 1 ? 'Training' : 'Trainings'}`].filter(Boolean).join(' · ')}</span></div>`;
  }).reverse().join('');
  return `<h1 class="display" style="font-size:30px">Körpergewicht</h1>
    <section class="card form">
      <b>Neuer Eintrag</b>
      <div class="grid2"><label>Gilt ab<input class="inp mono" type="date" id="bw-from" value="${todayStr()}" max="${todayStr()}"></label>
        <label>Gewicht<span class="field"><input id="bw-in" inputmode="decimal" autocomplete="off" placeholder="z. B. 82,4" aria-label="Körpergewicht in kg"><span>kg</span></span></label></div>
      <button class="btn primary" data-act="bw-save">Eintragen</button>
      <span class="help">Ein älteres Datum korrigiert genau diesen Zeitraum. Trainings rechnen mit dem Wert, der an ihrem Tag galt. ${(PROFILES[cfg.me] || {}).share_weight ? 'Deine Buddys sehen dein Körpergewicht (Freigabe in den Einstellungen).' : 'Nur du siehst dein Körpergewicht. Freigeben kannst du es in den Einstellungen.'}</span>
    </section>
    ${list.length > 1 ? `<section class="card chart"><b>Verlauf (kg)</b>${chartSvg([{ color: '#fff', points: pts }], 'Körpergewicht')}</section>` : ''}
    <section class="card">${periods || '<div class="empty">Noch kein Eintrag. Körpergewichtsübungen rechnen erst mit Gesamtlast, wenn hier ein Wert steht.</div>'}</section>`;
}

/* ---------- Notizen ---------- */

/* ---------- Planänderungen (Glocke) ---------- */
function viewBell() {
  const list = bellItems(), other = partner(), s = st();
  const label = { open: 'Neu', dismissed: 'Ausgeblendet', diverged: 'Weicht ab' };
  const oldOf = x => { const dec = s.decisions[cfg.me + '|' + x.pc.id]; return x.status !== 'open' && Date.now() - new Date((dec && dec.ts) || x.pc.ts) > 14 * 864e5; };
  const items = list.map(x => {
    const c = x.pc, inDraft = draft && draft.plan !== 'mine' && draft.day === x.day && !!s.plans[c.person][x.day];
    return `<section class="card" style="gap:14px">
      <div style="display:flex;align-items:center;gap:10px">${avatar(c.person, 36)}<div style="flex:1;display:flex;flex-direction:column"><b>${nm(c.person)}</b><span class="mono muted small">${fmtDate(c.ts)} · ${fmtTime(c.ts)}${x.status === 'diverged' ? ' · du hast den Tag danach geändert' : ''}</span></div><span class="pill ${x.status}">${label[x.status]}</span></div>
      <div style="display:flex;align-items:center;gap:8px"><span class="day t-${DAY_TONE[x.day]} lg">${esc((s.plans[c.person][x.day] || s.plans[cfg.me][x.day] || {}).short || DAY_SHORT[x.day])}</span><b style="font-size:16px">${esc((s.plans[c.person][x.day] || s.plans[cfg.me][x.day] || {}).title || '')}</b></div>
      ${diffList(x.diff)}
      <span class="small muted">Deine abweichenden Übungen und persönlichen Werte bleiben erhalten.</span>
      <div class="btnrow"><button class="btn primary" data-act="accept" data-id="${esc(c.id)}">In meinen Plan übernehmen</button>
        ${x.status === 'open' ? `<button class="btn" data-act="dismiss" data-id="${esc(c.id)}">Ausblenden</button>` : ''}</div>
      ${inDraft ? `<button class="btn ghost" data-act="accept-draft" data-id="${esc(c.id)}">Übernehmen und ins laufende Training</button><span class="small muted">Eingaben bleiben erhalten. Übungen mit Einträgen, die wegfallen, bleiben im Training als „Nicht mehr im Plan“.</span>` : ''}
    </section>`;
  });
  const recent = items.filter((h, i) => !oldOf(list[i])), older = items.filter((h, i) => oldOf(list[i]));
  const mine = DAYS.map(d => s.lastChange[cfg.me + '|' + d]).filter(Boolean);
  const mates = crewMates();
  const mineHtml = mine.map(c => {
    const b = s.plans[cfg.me][c.data.day];
    const open = mates.filter(o => { const a = s.plans[o][c.data.day]; return !((!a && !b) || (!!a && !!b && !sharedDiff(a, b).length)); });
    const same = !open.length, other = open[0] || mates[0];
    return `<div class="sess"><div class="top"><span style="display:flex;gap:8px;align-items:center;color:var(--fg)">${dayChip(c.data.day)}<b>${esc(c.data.title)}</b></span><span class="pill ${same ? 'accepted' : ''}">${same ? (mates.length > 1 ? 'bei allen gleich' : `bei ${nm(other)} gleich`) : `bei ${open.map(nm).join(', ')} offen`}</span></div><span class="mono muted small">zuletzt gespeichert ${fmtDate(c.ts)}, ${fmtTime(c.ts)}</span></div>`;
  }).join('');
  const nts = notices();
  return `${nts.length ? `<h1 class="display" style="font-size:30px">Hinweise</h1>${nts.map(noticeCard).join('')}` : ''}<h1 class="display" style="font-size:30px">Plan&shy;änderungen</h1>
    <p class="muted small" style="margin:0">Wenn jemand aus deiner Crew gemeinsame Übungen im Crew-Plan ändert, siehst du es hier. Abweichende Übungen und persönliche Werte lösen keine Meldung aus.</p>
    ${recent.join('') || `<section class="card"><div class="empty">${older.length ? 'Nichts Neues.' : hasCrew() ? 'Keine Unterschiede. Eure gemeinsamen Übungen sind gleich.' : 'Planänderungen gibt es, sobald du in einer Crew bist.'}</div></section>`}
    ${older.length ? `<details class="older"><summary>Ältere (${older.length})</summary><div style="display:flex;flex-direction:column;gap:12px;padding-top:12px">${older.join('')}</div></details>` : ''}
    ${mine.length && mates.length ? `<div class="sec-title"><h2>Deine Änderungen</h2></div><section class="card">${mineHtml}</section>` : ''}`;
}
function acceptChange(changeId, intoDraft) {
  const s = st(), c = s.changes[changeId]; if (!c) return;
  const theirs = s.plans[c.person][c.data.day];
  const merged = theirs ? mergePlan(s.plans[cfg.me][c.data.day] || EMPTY_DAY, theirs) : { deleted: true };
  addEvent('plan_decision', { changeId, decision: 'accepted', result: merged }, `Änderung von ${c.person} an ${dl(c.data.day)} übernommen`);
  if (builder && !Object.values(builder.dirty).some(Boolean)) builder = null;
  if (intoDraft && draft && draft.day === c.data.day && !merged.deleted) { applyToDraft(merged); toast(`${dl(c.data.day)} übernommen, auch ins laufende Training`); location.hash = '#training'; return; }
  toast(`${dl(c.data.day)} übernommen. Gilt ab dem nächsten Training.`);
  render();
}
function dismissChange(changeId) {
  const c = st().changes[changeId]; if (!c) return;
  addEvent('plan_decision', { changeId, decision: 'dismissed' }, `Änderung von ${c.person} an ${dl(c.data.day)} ausgeblendet`);
  toast('Ausgeblendet. Du kannst sie später noch übernehmen.');
  render();
}

/* ======================= Notizen (ab 3.0) =======================
   Eigene Tabelle „notes“, getrennt von den Trainings. Privat: nur ich, über alle Pläne. Crew: alle in meiner Crew.
   Offline zuerst: Änderungen stehen sofort in NOTES (mit „pend“) und gehen beim nächsten Sync an die Datenbank. */
let NOTES = (() => { const v = LS.get('notes', []); return Array.isArray(v) ? v : []; })();
const NOTE_OPEN = new Set();                        // aufgeklappte „Mehr …“ je Übung und Art
const ICON_LOCK14 = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const ICON_CREW14 = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/></svg>';
const ICON_DOWN14 = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const ICON_UP14 = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
function saveNotes() { LS.set('notes', NOTES); }
const liveNotes = () => NOTES.filter(n => n.pend !== 'del');
// Übungs-Kennung über Zusammenführungen in der Bibliothek auflösen
const noteEx = n => { const lib = st().lib; return lib ? libTarget(lib, n.ex_id) : n.ex_id; };
function notesFor(exId, k = 'crew') {
  const all = liveNotes().filter(n => noteEx(n) === exId).sort((a, b) => b.ts.localeCompare(a.ts));
  const priv = all.filter(n => n.scope === 'private' && n.user_id === cfg.me);
  const crew = k === 'crew' && hasCrew() ? all.filter(n => n.scope === 'crew' && n.crew_id === CREW.id) : [];
  return { priv, crew };
}
// Zeit: heute nur die Uhrzeit, sonst das Datum (ohne Namen mit Wochentag)
function noteWhen(ts, withDay) {
  if (dateKey(ts) === todayStr()) return fmtTime(ts);
  const d = new Date(ts);
  return (withDay ? ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'][d.getDay()] + ' ' : '') + `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.`;
}
function noteItem(n, solo) {
  const who = n.user_id === cfg.me ? 'Ich' : nm(n.user_id);
  const ed = n.edited_at ? ' <span class="edited">· bearbeitet</span>' : '';
  return solo
    ? `<div class="item solo" data-note="${esc(n.id)}"><span class="meta"><span class="t">${noteWhen(n.ts, true)}</span>${ed}</span><p>${esc(n.body)}</p></div>`
    : `<div class="item" data-note="${esc(n.id)}">${avatar(n.user_id, 18)}<span class="meta"><b>${who}</b> · <span class="t">${noteWhen(n.ts)}</span>${ed}</span><p>${esc(n.body)}</p></div>`;
}
// Ein Abschnitt: neueste Notiz, darunter „Mehr …“ (höchstens drei ältere), danach der Verweis in die Notizen-Ansicht
function noteSec(exId, list, kind, k, label) {
  if (!list.length) return '';
  const solo = kind === 'priv', key = exId + '|' + kind, open = NOTE_OPEN.has(key), older = list.slice(1);
  const ic = kind === 'priv' ? ICON_LOCK14 : ICON_CREW14;
  const more = older.length ? `<button type="button" class="more${solo ? ' solo-more' : ''}" data-act="note-more" data-v="${esc(key)}" aria-expanded="${open}">${open ? 'Weniger' : 'Mehr …'} ${ic}<span class="mono">${older.length}</span>${open ? ICON_UP14 : ICON_DOWN14}</button>` : '';
  const target = kind === 'priv' ? 'mine' : 'crew';
  const all = open && older.length > 3 ? `<a class="all" href="#notizen:${target}:${encodeURIComponent(exId)}">${kind === 'priv' ? 'Alle privaten Notizen' : 'Alle Crew-Notizen'} ›</a>` : '';
  return `<div class="sec">${label ? `<div class="lab">${kind === 'priv' ? ICON.lock.replace(/width="22" height="22"/, 'width="14" height="14"') : ICON_CREW14}${label}</div>` : ''}${noteItem(list[0], solo)}${more}${open ? `<div class="older${solo ? ' solo' : ''}">${older.slice(0, 3).map(n => noteItem(n, solo)).join('')}</div>${all}` : ''}</div>`;
}
// Notizen zu einer Übung in Plan und Training. Mein Plan: nur der private Teil, ohne Überschrift.
function notesBlock(exId, k) {
  const { priv, crew } = notesFor(exId, k);
  if (!priv.length && !crew.length) return '';
  if (k === 'mine') return `<div class="n3">${noteSec(exId, priv, 'priv', k, '')}</div>`;
  return `<div class="n3">${noteSec(exId, priv, 'priv', k, 'Privat')}${noteSec(exId, crew, 'crew', k, 'Crew')}</div>`;
}
// Neue Notiz anlegen (aus dem Training)
function addNote({ scope, plan, exId, day, workoutId, body, ts }) {
  body = String(body || '').trim().slice(0, 2000); if (!body) return null;
  if (scope === 'crew' && !hasCrew()) scope = 'private';
  const n = { id: uid(), user_id: cfg.me, scope, crew_id: scope === 'crew' ? CREW.id : null, plan: plan === 'mine' ? 'mine' : 'crew', ex_id: exId, day: day || null, workout_id: workoutId || null, ts: ts || new Date().toISOString(), body, edited_at: null, pend: 'ins' };
  NOTES.push(n); saveNotes(); return n;
}
function editNote(id, body) {
  const n = NOTES.find(x => x.id === id && x.user_id === cfg.me); body = String(body || '').trim().slice(0, 2000);
  if (!n || !body || body === n.body) return;
  n.body = body; n.edited_at = new Date().toISOString(); if (n.pend !== 'ins') n.pend = 'upd'; saveNotes();
}
function deleteNote(id) {
  const i = NOTES.findIndex(x => x.id === id && x.user_id === cfg.me); if (i < 0) return;
  if (NOTES[i].pend === 'ins') NOTES.splice(i, 1); else NOTES[i].pend = 'del';
  saveNotes();
}
// Notizen aus 2.2.1 (im Training gespeichert) einmalig als Crew-Notizen übernehmen, nur die eigenen
function legacyNotes() {
  if (LS.get('notes.mig.' + cfg.me, false)) return;
  // Übernommene Konten: die Crew entsteht erst, wenn der Buddy auch übernommen hat. Bis dahin warten, damit die Notizen geteilt bleiben.
  if (!hasCrew() && PROFILES[cfg.me] && PROFILES[cfg.me].legacy_name) return;
  const have = new Set(NOTES.map(n => n.id));
  st().workouts.filter(w => w.person === cfg.me).forEach(w => (w.data.entries || []).forEach(en => {
    const body = String(en.note || '').trim(); if (!body) return;
    const id = `legacy-${w.id}-${en.exId}`.slice(0, 80); if (have.has(id)) return;
    NOTES.push({ id, user_id: cfg.me, scope: hasCrew() ? 'crew' : 'private', crew_id: hasCrew() ? CREW.id : null, plan: 'crew', ex_id: en.exId, day: w.data.day, workout_id: w.id, ts: w.ts, body: body.slice(0, 2000), edited_at: null, pend: 'ins' });
  }));
  saveNotes(); LS.set('notes.mig.' + cfg.me, true);
}
const noteRow = n => ({ id: n.id, scope: n.scope, crew_id: n.crew_id, plan: n.plan, ex_id: n.ex_id, day: n.day, workout_id: n.workout_id, ts: n.ts, body: n.body });
let notesSyncing = null;
function notesSync() {
  if (notesSyncing) return notesSyncing;
  if (!cfg.me || cfg.key !== 'supabase' || navigator.onLine === false) return Promise.resolve();
  notesSyncing = (async () => {
    let changed = false;
    try {
      legacyNotes();
      for (const n of NOTES.filter(x => x.pend && x.user_id === cfg.me)) {
        let r;
        if (n.pend === 'ins') r = await sb.from('notes').upsert([noteRow(n)], { onConflict: 'id', ignoreDuplicates: true });
        else if (n.pend === 'upd') r = await sb.from('notes').update({ body: n.body, edited_at: n.edited_at }).eq('id', n.id);
        else r = await sb.from('notes').delete().eq('id', n.id);
        if (r.error) {
          const c = sbErr(r.error);
          if (c.code === 'network') throw r.error;
          n.err = String(c.msg || '').includes('anders') ? 'Bitte formuliere die Notiz anders.' : 'Nicht gespeichert';
          if (n.pend === 'del') { n.pend = null; delete n.err; }   // gibt es schon nicht mehr
          else n.pend = null;
          if (n.err && n.ts && !String(n.id).startsWith('legacy-')) toast(n.err);
          NOTES = NOTES.filter(x => x !== n || !x.err); changed = true; continue;
        }
        if (n.pend === 'del') NOTES = NOTES.filter(x => x !== n); else n.pend = null;
        changed = true;
      }
      saveNotes();
      const r = await sb.from('notes').select('id,user_id,scope,crew_id,plan,ex_id,day,workout_id,ts,body,edited_at').order('ts', { ascending: false }).limit(3000);
      if (r.error) throw r.error;
      const keep = NOTES.filter(n => n.pend);
      const next = (r.data || []).map(n => ({ ...n, ts: new Date(n.ts).toISOString() })).filter(n => !keep.some(k => k.id === n.id)).concat(keep);
      if (JSON.stringify(next.map(n => [n.id, n.body, n.edited_at])) !== JSON.stringify(NOTES.map(n => [n.id, n.body, n.edited_at]))) changed = true;
      NOTES = next; saveNotes();
    } catch (e) { /* nächster Versuch beim nächsten Sync */ }
    finally { notesSyncing = null; if (changed && ['plan', 'notizen', 'training', 'training-log'].includes(view)) safeRender(); }
  })();
  return notesSyncing;
}
/* Gedrückt halten auf einer Notiz: eigene bearbeiten oder löschen, fremde melden */
let NG = null;
document.addEventListener('pointerdown', ev => {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  const it = ev.target.closest('.n3 .item[data-note]'); if (!it) return;
  NG = { id: it.dataset.note, x0: ev.clientX, y0: ev.clientY };
  NG.lp = setTimeout(() => { if (NG) { if (navigator.vibrate) navigator.vibrate(8); openNoteMenu(NG.id); NG = null; } }, 450);
});
document.addEventListener('pointermove', ev => { if (NG && (Math.abs(ev.clientX - NG.x0) > 10 || Math.abs(ev.clientY - NG.y0) > 10)) { clearTimeout(NG.lp); NG = null; } });
['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, () => { if (NG) { clearTimeout(NG.lp); NG = null; } }));
function openNoteMenu(id, mode) {
  const n = liveNotes().find(x => x.id === id); if (!n) return;
  const mine = n.user_id === cfg.me;
  const ic = d => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  if (mode === 'edit') {
    $('#modal').innerHTML = `<div class="backdrop" data-act="mclose-bg"><form class="sheet form" id="noteedit" data-id="${esc(id)}" novalidate>
      <span class="eyebrow">${n.scope === 'crew' ? ICON_CREW14 + ' Crew-Notiz' : ICON_LOCK14 + ' Private Notiz'}</span><h2>Notiz bearbeiten</h2>
      <textarea class="inp" id="ne-body" rows="4" maxlength="2000">${esc(n.body)}</textarea>
      <div class="btnrow col"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" data-act="mclose">Abbrechen</button></div></form></div>`;
    setTimeout(() => { const t = $('#ne-body'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 30);
    return;
  }
  if (mode === 'del') {
    sheet(`<h2>Notiz löschen?</h2><div class="cdel-prev">${esc(n.body)}</div><p class="muted" style="margin:0">${n.scope === 'crew' ? 'Sie verschwindet auch bei deiner Crew.' : 'Sie verschwindet auf all deinen Geräten.'}</p>
      <div class="btnrow col"><button class="btn danger" data-act="note-del-yes" data-id="${esc(id)}">Löschen</button><button class="btn ghost" data-act="mclose">Abbrechen</button></div>`);
    return;
  }
  $('#modal').innerHTML = `<div class="cm-ov" data-act="mclose-bg"><div class="cm-box them" role="dialog" aria-modal="true" aria-label="Notiz">
    <div class="cm-msg">${esc(n.body)}</div>
    <div class="cm-acts">${mine
      ? `<button type="button" data-act="note-edit" data-id="${esc(id)}">Bearbeiten${ic('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>')}</button>
         <button type="button" class="danger-t" data-act="note-del" data-id="${esc(id)}">Löschen${ic('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>')}</button>`
      : `<button type="button" data-act="note-copy" data-id="${esc(id)}">Kopieren${ic('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>')}</button>
         <button type="button" class="danger-t" data-act="note-report" data-id="${esc(id)}">Melden${ic('<path d="M5 21V4h11l-1.5 4L16 12H5"/>')}</button>`}</div>
  </div></div>`;
}
async function reportNote(id) {
  const n = liveNotes().find(x => x.id === id); if (!n) return;
  const r = await sb.from('reports').insert({ target_type: 'note', target_id: id, content: n.body.slice(0, 4000) });
  const h = LS.get('notes.hidden.' + cfg.me, []); if (!h.includes(id)) h.push(id); LS.set('notes.hidden.' + cfg.me, h);
  NOTES = NOTES.filter(x => x.id !== id || x.user_id === cfg.me); saveNotes();
  closeModal(); toast(r.error ? 'Ausgeblendet. Melden klappt beim nächsten Mal.' : 'Gemeldet und ausgeblendet'); safeRender();
}

/* Notizen-Ansicht: eine Karte pro Übung mit allen Notizen, sortiert nach der neuesten Notiz.
   Crew-Plan: Crew-Notizen, Filter nach Person. Mein Plan: private Notizen, Filter nach Tag.
   Aus dem Training: Sprung zur Übung, Rest abgedunkelt bis zum ersten Scrollen oder Tippen. */
let notesFilter3 = { crew: 'all', mine: 'all' }, NOTE_FOCUS = null;
function viewNotes3(arg) {
  const [k0, ex0] = String(arg || '').split(':');
  const k = k0 === 'mine' ? 'mine' : k0 === 'crew' && hasCrew() ? 'crew' : (hasCrew() ? 'crew' : 'mine');
  const hidden = LS.get('notes.hidden.' + cfg.me, []);
  const lib = st().lib || {}, exName = id => (lib[id] && lib[id].name) || (st().exInfo[id] || {}).name || 'Übung';
  let list = liveNotes().filter(n => !hidden.includes(n.id) && (k === 'crew' ? n.scope === 'crew' && n.crew_id === CREW.id : n.scope === 'private' && n.user_id === cfg.me));
  const f = notesFilter3[k];
  let chips;
  if (k === 'crew') {
    const ppl = [cfg.me, ...(CREW.members || []).filter(p => p !== cfg.me)];
    chips = `<button class="dchip p" data-act="nfilt" data-k="crew" data-v="all" aria-pressed="${f === 'all'}">Alle</button>` + ppl.map(p => `<button class="dchip p" data-act="nfilt" data-k="crew" data-v="${esc(p)}" aria-pressed="${f === p}">${avatar(p, 24)}${p === cfg.me ? 'Ich' : nm(p)}</button>`).join('');
    if (f !== 'all') list = list.filter(n => n.user_id === f);
  } else {
    const days = pdays(cfg.me, 'mine'), pl = planOf(cfg.me, 'mine');
    chips = `<button class="dchip p" data-act="nfilt" data-k="mine" data-v="all" aria-pressed="${f === 'all'}">Alle</button>` + days.map(d => `<button class="dchip" data-act="nfilt" data-k="mine" data-v="${d}" aria-pressed="${f === d}"><i style="background:${TONE_HEX[DAY_TONE[d]]}"></i>${esc(dl(d, cfg.me, 'mine'))}</button>`).join('');
    if (f !== 'all' && pl[f]) { const ids = new Set(pl[f].exercises.map(x => x.id)); list = list.filter(n => ids.has(noteEx(n))); }
  }
  // Tag einer Übung im jeweiligen Plan, sonst der Tag der Notiz
  const pl = planOf(cfg.me, k), dayOf = (id, n) => PD(pl).find(d => pl[d].exercises.some(x => x.id === id)) || (DAYS.includes(n.day) ? n.day : 'A');
  const groups = new Map();
  list.slice().sort((a, b) => b.ts.localeCompare(a.ts)).forEach(n => { const id = noteEx(n); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(n); });
  const focus = NOTE_FOCUS && NOTE_FOCUS.dim && NOTE_FOCUS.ex;
  const cards = [...groups.entries()].map(([id, ns]) => {
    const d = dayOf(id, ns[0]);
    return `<section class="card xcard${id === focus ? ' hl' : focus ? ' ndim' : ''}" id="nc-${esc(id)}"><div class="xh">${dayChip(d, cfg.me, '', k)}<b>${esc(exName(id))}</b></div><div class="n3"><div class="sec">${ns.map(n => noteItem(n, k === 'mine')).join('')}</div></div></section>`;
  }).join('');
  const n = k === 'crew' ? (CREW.members || []).length : 0;
  return `<h1 class="display" style="font-size:30px">Notizen</h1>
    <span class="eyebrow" style="margin-top:-6px;display:flex;gap:8px;align-items:center">${k === 'crew' ? ICON_CREW14 + ` Crew-Plan · ${n} ${n === 1 ? 'Person' : 'Personen'}` : ICON_LOCK14 + ' Mein Plan · nur für dich'}</span>
    <div class="dscroll${focus ? ' ndim' : ''}" style="margin-right:-16px"><div class="rowc" role="group" aria-label="${k === 'crew' ? 'Nach Buddy filtern' : 'Nach Tag filtern'}">${chips}</div></div>
    ${cards || `<section class="card"><div class="empty">${k === 'crew' ? 'Noch keine Crew-Notizen. Notizen schreibst du im Training unter jeder Übung.' : 'Noch keine privaten Notizen. Notizen schreibst du im Training unter jeder Übung.'}</div></section>`}`;
}
function noteFocusEnd() { if (!NOTE_FOCUS || !NOTE_FOCUS.dim) return; NOTE_FOCUS.dim = false; document.querySelectorAll('.ndim').forEach(el => el.classList.remove('ndim')); document.querySelectorAll('.xcard.hl').forEach(el => el.classList.remove('hl')); }

/* ======================= Buddies und Crew (ab 3.0) =======================
   Freunde über die GymBuddy-ID (Suche oder QR-Code), Anfragen annehmen oder ablehnen.
   Eine Crew pro Person, höchstens 6. Der Crew-Chef lädt Freunde ein, benennt um und entfernt Mitglieder. */
const CREW_MAX = 6;
let SOCIAL = (() => { const v = LS.get('social', null); return v && typeof v === 'object' ? v : { incoming: [], outgoing: [], invites: [], crewInvites: [], crewMeta: null }; })();
const BUD = { q: '', found: null, msg: '', busy: false };
const isOwner = () => hasCrew() && CREW.owner === cfg.me;
const crewMates = () => (hasCrew() ? (CREW.members || []).filter(p => p !== cfg.me) : []);
const friendsList = () => Object.values(PROFILES).filter(p => p.friend && p.id !== cfg.me).map(p => p.id);
async function loadSocial(fr) {
  const me = cfg.me;
  const pend = (fr || []).filter(f => f.status === 'pending');
  const inv = await sb.from('crew_invites').select('crew_id,user_id,invited_by,created_at');
  const invites = (inv.data || []).filter(i => i.user_id === me);
  let crews = [];
  if (invites.length) { const r = await sb.from('crews').select('id,name,owner').in('id', invites.map(i => i.crew_id)); crews = r.data || []; }
  let crewMeta = null;
  if (hasCrew()) { const r = await sb.from('crews').select('id,name,created_at,owner').eq('id', CREW.id).maybeSingle(); crewMeta = r.data || null; }
  SOCIAL = {
    incoming: pend.filter(f => f.requested_by !== me).map(f => (f.a === me ? f.b : f.a)),
    outgoing: pend.filter(f => f.requested_by === me).map(f => (f.a === me ? f.b : f.a)),
    invites: invites.map(i => ({ crew: i.crew_id, by: i.invited_by, name: (crews.find(c => c.id === i.crew_id) || {}).name || 'Crew' })),
    crewInvites: (inv.data || []).filter(i => hasCrew() && i.crew_id === CREW.id).map(i => i.user_id),
    crewMeta
  };
  LS.set('social', SOCIAL);
}
const socialCount = () => (SOCIAL.incoming || []).length + (SOCIAL.invites || []).length;
// Datenbank-Aufruf mit Rückmeldung; danach Personen neu laden
async function rpcDo(fn, args, ok) {
  const r = await sb.rpc(fn, args || {});
  if (r.error) { const m = sbErr(r.error); toast(m.code === 'network' ? 'Keine Verbindung. Bitte später noch einmal.' : (m.msg || 'Das hat nicht geklappt.').replace(/^.*?: /, '')); return null; }
  if (ok) toast(ok);
  await sync({ quiet: true }); render();
  return r.data === null || r.data === undefined || r.data === '' ? true : r.data;   // Funktionen ohne Rückgabe: erfolgreich
}
async function buddySearch(code) {
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  BUD.q = c; BUD.found = null; BUD.msg = '';
  if (c.length < 8) { budRefresh(); return; }
  BUD.busy = true; budRefresh();
  const r = await sb.rpc('find_buddy', { code: c });
  BUD.busy = false;
  if (r.error) BUD.msg = sbErr(r.error).code === 'network' ? 'Keine Verbindung.' : (sbErr(r.error).msg || 'Suche nicht möglich.');
  else if (!(r.data || []).length) BUD.msg = c === (PROFILES[cfg.me] || {}).buddy_id ? 'Das ist deine eigene ID.' : 'Niemand mit dieser ID gefunden.';
  else BUD.found = r.data[0];
  budRefresh();
}
function budState(id) {
  if (!id) return '';
  if (PROFILES[id] && PROFILES[id].friend) return 'friend';
  if ((SOCIAL.outgoing || []).includes(id)) return 'sent';
  if ((SOCIAL.incoming || []).includes(id)) return 'incoming';
  return '';
}
const iniAv = (name, size, seed) => `<span class="av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;background:${AV_FILL[avIdx(seed || name)]}" aria-hidden="true">${esc((String(name || '?')[0] || '?').toUpperCase())}</span>`;
// Ergebnis der Suche: wird beim Tippen direkt ausgetauscht, damit das Eingabefeld den Fokus behält
function budResultHTML() {
  const f = BUD.found, stt = f ? budState(f.id) : '';
  const lbl = { friend: 'Befreundet', sent: 'Angefragt', incoming: 'Annehmen', '': 'Anfrage senden' }[stt];
  return `<span class="small muted">${BUD.busy ? 'Suche …' : BUD.msg ? esc(BUD.msg) : 'Die ID steht im Profil deines Buddys unter seinem Namen.'}</span>
      ${f ? `<div class="glass" style="border-radius:16px;padding:12px;display:flex;align-items:center;gap:12px">${iniAv(f.name, 44, f.id)}
        <span style="flex:1;display:flex;flex-direction:column"><b>${esc(f.name)}</b><span class="mono small muted">#${esc(f.buddy_id)}</span></span>
        <button class="btn primary" data-act="bud-send" data-id="${esc(f.id)}" ${stt === 'friend' || stt === 'sent' ? 'disabled' : ''} style="width:auto;min-height:40px;padding:0 14px;font-size:14px">${lbl}</button></div>` : ''}`;
}
function budRefresh() { const el = $('#bud-res'); if (el) el.innerHTML = budResultHTML(); else safeRender(); }
function viewBuddies() {
  const search = `<section class="card glass" style="gap:10px">
      <label for="bud-q" class="eyebrow">GymBuddy suchen</label>
      <div style="display:flex;gap:8px"><div style="flex:1;position:relative"><span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);opacity:.6;display:flex;pointer-events:none">${ICON.search.replace('<svg ', '<svg width="18" height="18" ')}</span>
        <input id="bud-q" class="inp mono srch" value="${esc(BUD.q)}" placeholder="ID eingeben, z. B. LN4K7QPA" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="9" style="padding-left:42px;letter-spacing:.08em;font-size:17px"></div>
        <a class="iconbtn glass" href="#scanner" aria-label="QR-Code scannen" style="width:52px;height:52px;border-radius:14px">${ICON.qr}</a></div>
      <div id="bud-res" style="display:flex;flex-direction:column;gap:10px">${budResultHTML()}</div>
    </section>`;
  const reqs = (SOCIAL.incoming || []).map(id => `<div class="brow">${avatar(id, 40)}<span class="bname"><b>${nm(id)}</b><span class="small muted">möchte dein Gym Buddy sein</span></span>
      <button class="btn small primary" data-act="bud-accept" data-id="${esc(id)}">Annehmen</button><button class="btn small ghost" data-act="bud-decline" data-id="${esc(id)}" aria-label="Ablehnen">${ICON.x}</button></div>`).join('');
  const cinv = (SOCIAL.invites || []).map(i => `<div class="brow">${iniAv(i.name, 40, i.crew)}<span class="bname"><b>${esc(i.name)}</b><span class="small muted">${nm(i.by)} lädt dich in die Crew ein</span></span>
      <button class="btn small primary" data-act="crew-join" data-id="${esc(i.crew)}">Beitreten</button><button class="btn small ghost" data-act="crew-inv-no" data-id="${esc(i.crew)}" aria-label="Ablehnen">${ICON.x}</button></div>`).join('');
  const out = (SOCIAL.outgoing || []).map(id => `<div class="brow">${avatar(id, 40)}<span class="bname"><b>${nm(id)}</b><span class="small muted">Anfrage gesendet</span></span><button class="btn small ghost" data-act="bud-cancel" data-id="${esc(id)}">Zurückziehen</button></div>`).join('');
  const n = hasCrew() ? (CREW.members || []).length : 0;
  const crew = hasCrew() ? `<section class="card glass" style="gap:14px">
      <a href="#crew" style="display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--fg)">${avatar(crewKey(), 48)}
        <span style="flex:1;display:flex;flex-direction:column"><b style="font-size:17px">${esc(CREW.name)}</b><span class="small muted">${n} von ${CREW_MAX}${isOwner() ? ' · du bist Crew-Chef' : ''}</span></span>
        <span class="iconbtn glass" aria-hidden="true">${ICON.right}</span></a>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">
        <a class="btn glass" href="#chat:${encodeURIComponent(crewKey())}" style="min-height:44px;font-size:14px;padding:0 6px;white-space:nowrap">Crew-Chat</a>
        <a class="btn glass" href="#plan" data-act="goto-crewplan" style="min-height:44px;font-size:14px;padding:0 6px;white-space:nowrap">Crew-Plan</a>
        <button class="btn glass" data-act="crew-invite" style="min-height:44px;font-size:14px;padding:0 6px;white-space:nowrap" ${isOwner() && n < CREW_MAX ? '' : 'disabled'}>Einladen</button></div></section>`
    : `<section class="card nocrew"><h2>Du bist noch in keiner Crew</h2><p>Gründe eine mit deinen Buddies und trainiert nach einem gemeinsamen Plan.</p><a class="btn primary" href="#crew" style="width:100%">${ICON_CREW14.replace(/14/g, '20')}Crew gründen</a></section>`;
  const fl = friendsList().sort((a, b) => pname(a).localeCompare(pname(b), 'de'));
  const frows = fl.map((id, i) => { const x = flameStats(id), g = x.goal, ap = pauseOn(id, todayStr());
    return `<a class="brow" href="#profil:${encodeURIComponent(id)}" style="${i < fl.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,.12)' : ''}">${avatar(id, 40)}<span class="bname"><b>${nm(id)}</b><span class="small muted">${ap ? `Pause bis ${pzDate(ap.to)}` : `${x.week.length} von ${g} diese Woche`}${crewMates().includes(id) ? ' · Crew' : ''}</span></span><span class="fl-n" aria-label="${x.streak} Wochen Streak">${flameImg(id)}<b>${x.streak}</b></span></a>`; }).join('');
  return `${search}
    ${reqs || cinv ? `<div class="sec-title"><h2>Anfragen</h2></div><section class="card glass" style="padding:4px 16px;gap:0">${cinv}${reqs}</section>` : ''}
    <div class="sec-title"><h2>Crew</h2></div>${crew}
    <div class="sec-title"><h2>Freunde <span class="mono muted" style="font-size:13px;font-weight:500">${fl.length}</span></h2></div>
    ${fl.length ? `<section class="card glass" style="padding:4px 16px;gap:0">${frows}</section>` : `<section class="card"><div class="empty">Noch keine Gym Buddys. Suche nach einer ID oder scanne den QR-Code im Profil deines Buddys.</div></section>`}
    ${out ? `<div class="sec-title"><h2>Gesendet</h2></div><section class="card glass" style="padding:4px 16px;gap:0">${out}</section>` : ''}`;
}
// Wer neu in eine Crew kommt, übernimmt den Crew-Plan des Crew-Chefs (sonst stünden alle alten Änderungen in der Glocke)
function adoptCrewPlan() {
  if (!hasCrew() || CREW.owner === cfg.me) return;
  const s = st(), from = s.plans[CREW.owner], mine = s.plans[cfg.me]; if (!from || !PD(from).length) return;
  PD(from).forEach(d => { if (!mine[d] || sharedDiff(mine[d], from[d]).length) addEvent('plan_change', { day: d, title: from[d].title, short: from[d].short, exercises: clone(from[d].exercises).map(x => ({ ...x, personal: false })), changes: [], v2: true, adopt: true }, `Crew-Plan übernommen: ${from[d].short}`); });
  PD(mine).forEach(d => { if (!from[d]) addEvent('plan_change', { day: d, deleted: true, short: mine[d].short, title: mine[d].title, adopt: true }, `Crew-Plan übernommen: ${mine[d].short} entfällt`); });
}
/* ---------- Crew-Info ---------- */
let CREWV = { edit: false, invite: false, leave: false, rm: null, name: '' };
function viewCrew() {
  if (!hasCrew()) return `<h1 class="display" style="font-size:30px">Crew gründen</h1>
    <p class="muted" style="margin:0">Mit einer Crew trainiert ihr nach einem gemeinsamen Plan, teilt Notizen und habt einen Crew-Chat. Bis zu ${CREW_MAX} Personen.</p>
    <section class="card form"><label>Name der Crew<input class="inp" id="crew-name" maxlength="24" placeholder="z. B. Eisenfamilie" value="${esc(CREWV.name)}" autocomplete="off"></label>
      <div class="err" id="crew-err" hidden></div><button class="btn primary" data-act="crew-create">Crew gründen</button></section>
    <p class="small muted" style="margin:0 2px">Danach lädst du Freunde ein. Dein Plan wird zum Crew-Plan, „Mein Plan“ bleibt nur für dich.</p>`;
  const meta = SOCIAL.crewMeta, mem = CREW.members || [], own = isOwner();
  const rows = mem.map((id, i) => `<div style="display:flex;align-items:center;gap:12px;min-height:60px;${i < mem.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,.12)' : ''}">${avatar(id, 40)}
      <span style="flex:1;display:flex;flex-direction:column"><b style="${id === cfg.me ? '' : `color:${nameColor(id)}`}">${id === cfg.me ? 'Du' : nm(id)}</b><span class="small muted">${id === CREW.owner ? 'Crew-Chef' : 'Mitglied'}</span></span>
      ${own && id !== cfg.me ? (CREWV.rm === id ? `<button class="btn small danger" data-act="crew-rm-yes" data-id="${esc(id)}">Entfernen</button><button class="btn small ghost" data-act="crew-rm-no">Nein</button>` : `<button class="btn small ghost" data-act="crew-rm" data-id="${esc(id)}">Entfernen</button>`) : ''}</div>`).join('');
  const pendingInv = (SOCIAL.crewInvites || []).filter(id => !mem.includes(id));
  const cands = friendsList().filter(id => !mem.includes(id) && !pendingInv.includes(id));
  return `<div class="pf" style="position:relative"><div class="pf-ring">${avatar(crewKey(), 114)}</div>
      ${CREWV.edit ? `<label style="width:100%"><input class="inp" id="crew-rename" value="${esc(CREW.name)}" maxlength="24" aria-label="Crew-Name" style="text-align:center;font-family:var(--display);font-weight:800;font-size:24px"></label><button class="lnk" data-act="crew-rename">Fertig</button>`
        : `<button ${own ? 'data-act="crew-edit"' : 'disabled'} style="background:none;border:0;color:#fff;display:flex;align-items:center;gap:10px;cursor:${own ? 'pointer' : 'default'};padding:0" aria-label="Crew-Namen ändern"><h1 class="display" style="font-size:36px">${esc(CREW.name)}</h1>${own ? ICON.pen.replace(/20/g, '18') : ''}</button>`}
      <span class="mono muted small">Crew · ${mem.length} von ${CREW_MAX}${meta && meta.created_at ? ' · gegründet ' + new Date(meta.created_at).toLocaleDateString('de-DE') : ''}</span></div>
    <div class="sec-title"><h2>Mitglieder</h2><span class="mono muted small">${mem.length} / ${CREW_MAX}</span></div>
    <section class="card glass" style="padding:4px 16px;gap:0">${rows}</section>
    <span class="small muted" style="margin:0 2px">Die Namensfarbe ist die Chat-Farbe jedes Mitglieds.</span>
    ${pendingInv.length ? `<div class="sec-title"><h2>Eingeladen</h2></div><section class="card glass" style="padding:4px 16px;gap:0">${pendingInv.map(id => `<div class="brow">${avatar(id, 36)}<span class="bname"><b>${nm(id)}</b><span class="small muted">wartet auf Antwort</span></span></div>`).join('')}</section>` : ''}
    ${own && mem.length < CREW_MAX ? (CREWV.invite ? `<section class="card" style="gap:10px"><b>Buddy einladen</b>${cands.length ? cands.map(id => `<div class="brow">${avatar(id, 36)}<span class="bname"><b>${nm(id)}</b></span><button class="btn small primary" data-act="crew-invite-yes" data-id="${esc(id)}">Einladen</button></div>`).join('') : '<span class="small muted">Alle deine Freunde sind schon in der Crew oder eingeladen. Weitere Buddys findest du über ihre ID.</span>'}<button class="btn small ghost" data-act="crew-invite-no">Schließen</button></section>`
      : `<button class="btn glass" data-act="crew-invite">Buddy einladen</button>`) : ''}
    ${CREWV.leave ? `<section class="card"><b>Crew wirklich verlassen?</b><span class="small muted">Deine Crew-Notizen bleiben in der Crew, du bekommst sie als private Notizen mit. Genutzte eigene Übungen der Crew bleiben für dich nutzbar.${own && mem.length > 1 ? ' Die Chef-Rolle geht an das älteste Mitglied.' : ''}</span>
        <div class="btnrow"><button class="btn small danger" data-act="crew-leave-yes">Verlassen</button><button class="btn small ghost" data-act="crew-leave-no">Abbrechen</button></div></section>`
      : `<button class="btn ghost danger-t" data-act="crew-leave" style="border-color:var(--danger)">Crew verlassen</button>`}`;
}
/* ---------- Buddy-Menü im Profil: entfernen, blockieren, melden ---------- */
function buddyMenu(p, mode) {
  const sameCrew = crewMates().includes(p);
  if (mode === 'block') {
    sheet(`<h2>${nm(p)} blockieren?</h2><p class="muted" style="margin:0">Ihr seht gegenseitig nichts mehr voneinander: Trainings, Notizen, Chat, Spots und Flammen. ${nm(p)} erfährt nicht, dass du blockiert hast.</p>
      ${sameCrew ? `<div class="notice card"><b>Ihr seid in derselben Crew.</b><span class="small">${isOwner() ? `Wenn du blockierst, wird ${nm(p)} aus der Crew entfernt.` : 'Wenn du blockierst, verlässt du die Crew.'}</span></div>` : ''}
      <div class="btnrow col"><button class="btn danger" data-act="bud-block-yes" data-id="${esc(p)}">Blockieren</button><button class="btn ghost" data-act="mclose">Abbrechen</button></div>`); return;
  }
  if (mode === 'remove') {
    sheet(`<h2>${nm(p)} entfernen?</h2><p class="muted" style="margin:0">Ihr seid dann keine Gym Buddys mehr und seht eure Trainings nicht mehr.${sameCrew ? ' In der Crew bleibt ihr beide.' : ''}</p>
      <div class="btnrow col"><button class="btn danger" data-act="bud-remove-yes" data-id="${esc(p)}">Entfernen</button><button class="btn ghost" data-act="mclose">Abbrechen</button></div>`); return;
  }
  if (mode === 'report') {
    sheet(`<h2>${nm(p)} melden</h2><span class="eyebrow">Warum?</span>
      <div class="pick col" role="radiogroup">${['Unangemessener Name oder Bild', 'Belästigung', 'Spam oder Betrug', 'Etwas anderes'].map((r, i) => `<label class="chk"><input type="radio" name="rep-why" value="${esc(r)}" ${i === 0 ? 'checked' : ''}><span>${esc(r)}</span></label>`).join('')}</div>
      <label class="chk"><input type="checkbox" id="rep-block"><span>${nm(p)} zusätzlich blockieren</span></label>
      <span class="small muted">${nm(p)} erfährt nicht, wer gemeldet hat.</span>
      <div class="btnrow col"><button class="btn danger" data-act="bud-report-yes" data-id="${esc(p)}">Melden</button><button class="btn ghost" data-act="mclose">Abbrechen</button></div>`); return;
  }
  sheet(`<h2>${nm(p)}</h2><div class="cm-acts" style="width:100%">
      <button type="button" data-act="chat-open" data-p="${esc(p)}">Nachricht schreiben${ICON.chat.replace('width="20" height="20"', 'width="18" height="18"')}</button>
      ${PROFILES[p] && PROFILES[p].friend ? `<button type="button" data-act="bud-remove" data-id="${esc(p)}">Als Buddy entfernen${ICON.x}</button>` : ''}
      <button type="button" class="danger-t" data-act="bud-block" data-id="${esc(p)}">Blockieren</button>
      <button type="button" class="danger-t" data-act="bud-report" data-id="${esc(p)}">Melden</button></div>
    <button class="btn ghost" data-act="mclose">Schließen</button>`);
}
/* ---------- QR-Code: eigene ID zeigen, Code eines Buddys scannen ---------- */
function qrSvg(text, px = 220) {
  if (typeof qrcode !== 'function') return '';
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), m = 2, s = n + m * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg width="${px}" height="${px}" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges" role="img" aria-label="QR-Code"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
const buddyLink = id => `BUILT:${id}`;
function idSheet() {
  const id = (PROFILES[cfg.me] || {}).buddy_id || '';
  $('#modal').innerHTML = `<div class="backdrop" data-act="mclose-bg" style="background:rgba(0,0,0,.92)"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="qr-t" style="align-items:center;text-align:center;gap:18px;background:transparent;border:0">
    <div style="align-self:stretch;display:flex;justify-content:flex-end"><button class="iconbtn glass" data-act="mclose" aria-label="Schließen">${ICON.x}</button></div>
    <h1 class="display" id="qr-t" style="font-size:30px;align-self:flex-start;text-align:left;margin:0">Deine<br>GymBuddy-ID</h1>
    <div style="padding:14px;border-radius:22px;background:#fff">${qrSvg(buddyLink(id), 220)}</div>
    <button class="mono" data-act="acct-copy" style="font-size:24px;font-weight:700;letter-spacing:.1em;padding:12px 26px;border-radius:14px;background:rgba(255,255,255,.08);border:1px solid var(--gline);color:#fff;cursor:pointer" aria-label="ID kopieren">#${esc(id)}</button>
    <p class="muted" style="margin:0;max-width:280px">Lass deinen Buddy diesen Code in BUILT scannen.</p>
    <a class="btn glass" href="#scanner" data-act="mclose" style="align-self:stretch">Code eines Buddys scannen</a>
  </div></div>`;
}
const SCAN = { stream: null, raf: 0, found: null, err: '', busy: false };
function loadScript(src) { return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
function viewScanner() {
  const f = SCAN.found, stt = f ? budState(f.id) : '';
  return `<div class="scan">
    <div class="head"><a class="iconbtn glass" href="#buddies" aria-label="Schließen">${ICON.x}</a><span style="flex:1;text-align:center;font-weight:600">Buddy-Code scannen</span><span style="width:44px"></span></div>
    <div class="scan-c"><div class="scan-f"><video id="scan-v" playsinline muted></video><i class="c1"></i><i class="c2"></i><i class="c3"></i><i class="c4"></i><span class="scan-l"></span></div>
      <p style="margin:0;text-align:center;max-width:260px;font-weight:500">${SCAN.err ? esc(SCAN.err) : 'Halte die Kamera auf den QR-Code im Profil deines Buddys.'}</p></div>
    <div style="padding:0 16px calc(24px + var(--sab, 0px))">
      ${f ? `<div class="card glass" style="background:rgba(20,20,22,.85)"><span class="eyebrow">Erkannt</span>
        <div style="display:flex;align-items:center;gap:12px">${iniAv(f.name, 48, f.id)}<span style="flex:1;display:flex;flex-direction:column"><b style="font-size:17px">${esc(f.name)}</b><span class="mono small muted">#${esc(f.buddy_id)}</span></span></div>
        <button class="btn primary" data-act="bud-send" data-id="${esc(f.id)}" ${stt === 'friend' || stt === 'sent' ? 'disabled' : ''}>${{ friend: 'Schon befreundet', sent: 'Angefragt', incoming: 'Annehmen', '': 'Anfrage senden' }[stt]}</button></div>` : ''}
      <p class="small muted" style="text-align:center;margin:12px 0 0">Kein QR-Code zur Hand? <a href="#buddies" data-act="scan-type">ID eintippen</a></p></div>
  </div>`;
}
async function startScan() {
  SCAN.found = null; SCAN.err = '';
  try {
    await loadScript('vendor/jsqr-1.4.0.js');
    SCAN.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    const v = $('#scan-v'); if (!v) return stopScan();
    v.srcObject = SCAN.stream; await v.play();
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (view !== 'scanner' || !SCAN.stream) return;
      if (v.videoWidth && !SCAN.busy) {
        const w = 360, h = Math.round(v.videoHeight * w / v.videoWidth); cv.width = w; cv.height = h; cx.drawImage(v, 0, 0, w, h);
        const r = window.jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        const m = r && /^BUILT:([A-Z0-9]{8})$/i.exec(r.data.trim());
        if (m && (!SCAN.found || SCAN.found.buddy_id !== m[1].toUpperCase())) {
          SCAN.busy = true;
          const q = await sb.rpc('find_buddy', { code: m[1] });
          SCAN.busy = false;
          if (!q.error && q.data && q.data.length) { SCAN.found = q.data[0]; if (navigator.vibrate) navigator.vibrate(10); render(); return; }
        }
      }
      SCAN.raf = requestAnimationFrame(tick);
    };
    tick();
  } catch (e) { SCAN.err = 'Kamera nicht verfügbar. Erlaube den Kamerazugriff oder tippe die ID ein.'; render(); }
}
function stopScan() { cancelAnimationFrame(SCAN.raf); if (SCAN.stream) SCAN.stream.getTracks().forEach(t => t.stop()); SCAN.stream = null; }
/* ---------- Wochenziel ---------- */
// Ziel einer Woche: ab dem Montag, ab dem eine Änderung gilt, das neue Ziel
function weekGoal(p, weekTs) {
  const pr = PROFILES[p] || {}, base = Math.min(6, Math.max(1, int(pr.week_goal) || 3));
  if (pr.week_goal_next && pr.week_goal_from) { const from = new Date(pr.week_goal_from + 'T00:00:00').getTime(); if ((weekTs ?? weekOf(Date.now())) >= from) return int(pr.week_goal_next) || base; }
  return base;
}
function goalSheet() {
  const pr = PROFILES[cfg.me] || {}, cur = weekGoal(cfg.me), nxt = pr.week_goal_next && pr.week_goal_from && new Date(pr.week_goal_from) > new Date() ? int(pr.week_goal_next) : cur;
  const mon = new Date(weekOf(Date.now()) + 7 * 864e5);
  sheet(`<h2>Wochenziel</h2><p class="muted" style="margin:0">Wie oft willst du pro Woche trainieren?</p>
    <div class="wz" role="radiogroup" aria-label="Trainings pro Woche">${[1, 2, 3, 4, 5, 6].map(n => `<button type="button" class="wzb ${n === nxt ? 'on' : ''}" role="radio" data-act="goal-pick" data-v="${n}" aria-checked="${n === nxt}">${n}</button>`).join('')}</div>
    <span class="small muted" id="goal-hint">Gilt ab Montag, ${mon.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}. Diese Woche zählt noch dein bisheriges Ziel (${cur}).</span>
    <div class="btnrow col"><button class="btn primary" data-act="goal-save" data-v="${nxt}">Speichern</button><button class="btn ghost" data-act="mclose">Abbrechen</button></div>`);
}

/* ======================= Datenschutz, Daten, Feedback (ab 3.0) =======================
   Einwilligungen stehen in „consents“ (jede Änderung ein neuer Eintrag, der letzte gilt).
   Gesundheitsdaten (Körpergewicht, Vault-Bilder) erst nach eigener Einwilligung. Statistik nur mit Zustimmung. */
const LEGAL = {   // Angaben für Impressum und Datenschutz
  name: 'Immanuel Kalis', street: 'Schulstraße 20G', city: '21465 Reinbek', mail: 'kontakt@builtapp.de', report: 'kontakt@builtapp.de', phone: '0152 27938278'
};
const CONSENT_V = '3.0';
let CONSENTS = (() => { const v = LS.get('consents', null); return v && typeof v === 'object' ? v : {}; })();
const hasConsent = k => CONSENTS[k] === true;
async function loadConsents() {
  const r = await sb.from('consents').select('kind,granted,created_at').order('created_at', { ascending: true });
  if (r.error) return;
  const m = {}; (r.data || []).forEach(c => { m[c.kind] = !!c.granted; });
  CONSENTS = m; LS.set('consents', CONSENTS);
}
async function setConsent(kind, granted) {
  const r = await sb.from('consents').insert({ kind, version: CONSENT_V, granted });
  if (r.error) { toast('Speichern hat nicht geklappt. Bitte später noch einmal.'); return false; }
  CONSENTS[kind] = granted; LS.set('consents', CONSENTS); return true;
}
// Einwilligung für Gesundheitsdaten, einmalig vor dem ersten Eintrag
function healthSheet(then, kind) {
  HEALTH_NEXT = then;
  if (kind === 'pause') {
    sheet(`<span class="eyebrow">Einmalig</span><h2>Grund speichern?</h2>
      <p class="muted" style="margin:0">„Krank“ und „Verletzt“ gelten als Gesundheitsangaben. Wir speichern sie deshalb nur, wenn du ausdrücklich zustimmst.</p>
      <ul class="dots"><li>Den Grund siehst <b>nur du</b>. Deine Buddys sehen höchstens „Pause“, und auch das nur, wenn du es teilst.</li><li>Gespeichert in der EU (Frankfurt).</li><li>Jederzeit widerrufbar. Dabei werden die Gründe gelöscht, die Pausen bleiben.</li></ul>
      <span class="small muted">Dieselbe Einwilligung gilt für Körpergewicht und Fortschrittsbilder im Vault. Mehr in der <a href="#rechtliches:datenschutz" data-act="mclose">Datenschutzerklärung</a>.</span>
      <div class="btnrow col"><button class="btn primary" data-act="health-yes">Zustimmen</button><button class="btn ghost" data-act="pz-reopen">Nicht jetzt</button></div>`);
    return;
  }
  sheet(`<span class="eyebrow">Einmalig vor dem ersten Eintrag</span><h2>Körpergewicht speichern?</h2>
    <p class="muted" style="margin:0">Dein Körpergewicht gilt als Gesundheitsdatum. Wir speichern es deshalb nur, wenn du ausdrücklich zustimmst.</p>
    <ul class="dots"><li>Standardmäßig <b>privat</b>. Freunde sehen es nur, wenn du es unter „Privatsphäre“ freigibst.</li><li>Gespeichert in der EU (Frankfurt), nur für deinen Verlauf.</li><li>Jederzeit widerrufbar. Dabei kannst du alle bisherigen Einträge löschen.</li></ul>
    <span class="small muted">Dasselbe gilt für Fortschrittsbilder im Vault. Mehr in der <a href="#rechtliches:datenschutz" data-act="mclose">Datenschutzerklärung</a>.</span>
    <div class="btnrow col"><button class="btn primary" data-act="health-yes">Zustimmen und speichern</button><button class="btn ghost" data-act="mclose">Nicht jetzt</button></div>`);
}
let HEALTH_NEXT = null;
function healthWithdrawSheet() {
  sheet(`<h2>Einwilligung widerrufen?</h2><p class="muted" style="margin:0">Körpergewicht, Vault-Bilder und die Pausengründe „krank“ und „verletzt“ werden nicht mehr gespeichert. Was soll mit den bisherigen Einträgen passieren?</p>
    <div class="btnrow col"><button class="btn danger" data-act="health-del">Widerrufen und alles löschen</button><button class="btn" data-act="health-keep">Widerrufen, Einträge behalten</button><button class="btn ghost" data-act="mclose">Abbrechen</button></div>`);
}
async function healthDeleteAll() {
  closeModal();
  const r = await sb.rpc('delete_health_data');
  if (r.error) { toast('Löschen hat nicht geklappt. Bitte später noch einmal.'); return; }
  CONSENTS.health = false; LS.set('consents', CONSENTS);
  for (const x of await IDB.all(cfg.me)) await IDB.del(x.id);
  ['vault.', 'vault.tok.', 'vault.cloud.', 'vault.tomb.'].forEach(k => localStorage.removeItem('hb.' + k + cfg.me));
  lockVault();
  events = events.filter(e => !(e.person === cfg.me && e.type === 'bodyweight')); pending = pending.filter(e => e.type !== 'bodyweight');
  [...events, ...pending].forEach(e => { if (e.person === cfg.me && e.type === 'pause' && e.data && (e.data.reason === 'krank' || e.data.reason === 'verletzt')) delete e.data.reason; });
  saveLog(); invalidate();
  toast('Widerrufen. Körpergewicht, Vault-Bilder und Pausengründe sind gelöscht.'); render();
}
// Nutzungsstatistik: einmal fragen, nur mitzählen, welche Bereiche genutzt werden
function statsSheet() {
  LS.set('stats.asked', true);
  sheet(`<h2>Hilf mit, BUILT besser zu machen</h2><p class="muted" style="margin:0">Darf die App anonym mitzählen, welche Bereiche ihr nutzt? Das hilft zu entscheiden, was als Nächstes verbessert wird.</p>
    <div class="card" style="gap:6px"><span class="eyebrow">Gezählt wird</span><span class="small">Welche Screens und Funktionen genutzt werden, App-Version, Gerätetyp, Tag.</span>
      <span class="eyebrow" style="margin-top:6px">Nie</span><span class="small">Namen, Gewichte, Trainingsinhalte, Chats, Spots, Bilder. Keine fremden Dienste, die Daten bleiben in Frankfurt und werden nach 90 Tagen gelöscht.</span></div>
    <div class="btnrow"><button class="btn ghost" data-act="stats-no">Nicht teilen</button><button class="btn primary" data-act="stats-yes">Teilen</button></div>
    <span class="small muted">Jederzeit änderbar unter Einstellungen → Privatsphäre.</span>`);
}
let USAGE_Q = [];
const usageId = () => { let v = LS.get('usage.id', ''); if (!v) { v = uid(); LS.set('usage.id', v); } return v; };
function trackView(name) { if (hasConsent('analytics') && name && !USAGE_Q.includes(name)) USAGE_Q.push(name); }
async function flushUsage() {
  if (!hasConsent('analytics') || !USAGE_Q.length || navigator.onLine === false) return;
  const day = todayStr(), sent = LS.get('usage.sent', {}), list = USAGE_Q.filter(n => sent[n] !== day); USAGE_Q = [];
  if (!list.length) return;
  const plat = /iPhone|iPad/.test(navigator.userAgent) ? 'iOS' : /Android/.test(navigator.userAgent) ? 'Android' : 'Web';
  const r = await sb.from('usage_events').insert(list.map(name => ({ anon_id: usageId(), name, app_version: APP_VERSION, platform: plat })));
  if (!r.error) { list.forEach(n => { sent[n] = day; }); LS.set('usage.sent', sent); }
}
/* ---------- Seiten ---------- */
function viewPrivacy() {
  const pr = PROFILES[cfg.me] || {};
  const rowS = (t, sub, v) => `<div class="row" style="min-height:64px"><span style="display:flex;flex-direction:column;gap:2px"><span>${t}</span><span class="small muted">${sub}</span></span><span class="v">${v}</span></div>`;
  return `<h1 class="display" style="font-size:30px">Privatsphäre</h1>
    <div class="secl">Deine Freunde und Crew sehen</div>
    <div class="rows glass">${rowS('Trainings, Rekorde, Flammen', 'Gehört zum Kern der App', 'immer')}${rowS('Profilbild und Name', 'Fremde sehen sie nur bei der Suche per ID', 'immer')}
      <label class="row tgl" style="cursor:pointer;min-height:64px"><span style="display:flex;flex-direction:column;gap:2px"><span>Körpergewicht</span><span class="small muted">${pr.share_weight ? 'Deine Buddys sehen es' : 'Nur du siehst es'}</span></span><input type="checkbox" role="switch" id="share-w" ${pr.share_weight ? 'checked' : ''}><i aria-hidden="true"></i></label>
      <label class="row tgl" style="cursor:pointer;min-height:64px"><span style="display:flex;flex-direction:column;gap:2px"><span>Pausen</span><span class="small muted">${pr.share_pause ? 'Deine Buddys sehen „Pause bis …“, nie den Grund' : 'Nur du siehst sie'}</span></span><input type="checkbox" role="switch" id="share-p" ${pr.share_pause ? 'checked' : ''}><i aria-hidden="true"></i></label></div>
    <span class="small muted" style="padding:0 4px">Chats, Spots und Vault sind Ende-zu-Ende-verschlüsselt. Nur du und die Empfänger können sie lesen, auch der Betreiber nicht.</span>
    <div class="secl">Einwilligungen</div>
    <div class="rows glass">
      <div class="row" style="min-height:64px"><span style="display:flex;flex-direction:column;gap:2px"><span>Gesundheitsdaten</span><span class="small muted">${hasConsent('health') ? 'Erteilt: Körpergewicht, Vault, Pausengrund' : 'Nicht erteilt'}</span></span>${hasConsent('health') ? '<button class="lnk" data-act="health-withdraw">Widerrufen</button>' : '<button class="lnk" data-act="health-ask">Erteilen</button>'}</div>
      <label class="row tgl" style="cursor:pointer;min-height:64px"><span style="display:flex;flex-direction:column;gap:2px"><span>Nutzungsstatistik teilen</span><span class="small muted">Anonym, ohne Inhalte, 90 Tage</span></span><input type="checkbox" role="switch" id="stats-tgl" ${hasConsent('analytics') ? 'checked' : ''}><i aria-hidden="true"></i></label>
    </div>
    <div class="rows glass"><a class="row" href="#rechtliches:datenschutz">Datenschutzerklärung<span class="v">›</span></a><a class="row" href="#daten">Deine Daten<span class="v">›</span></a></div>`;
}
let DATA = { del: false, file: null };
function viewData() {
  const pr = PROFILES[cfg.me] || {}, until = pr.deleted_at ? new Date(new Date(pr.deleted_at).getTime() + 30 * 864e5) : null;
  return `<h1 class="display" style="font-size:30px">Deine Daten</h1>
    ${until ? `<section class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Löschung beantragt</b><span class="small">Dein Konto wird am <b>${until.toLocaleDateString('de-DE')}</b> endgültig gelöscht. Bis dahin kannst du es dir anders überlegen.</span><button class="btn" data-act="del-cancel">Löschung zurücknehmen</button></section>` : ''}
    <section class="card"><b>Daten exportieren</b><span class="small muted">Profil, Trainings, Pläne, Notizen, Bibliothek, Freunde und Einwilligungen als eine Datei. Chats bleiben verschlüsselt. Vault-Bilder sicherst du im Vault über „Backup“.</span>
      <button class="btn" data-act="data-export">Export erstellen</button>
      ${DATA.file ? `<div class="filerow"><span class="mono small">${esc(DATA.file.name)}<br><span class="muted">${Math.max(1, Math.round(DATA.file.size / 1024))} KB</span></span><button class="lnk" data-act="data-share">Teilen</button></div>` : ''}</section>
    ${until ? '' : `<section class="card"><b>Konto löschen</b><span class="small muted">Dein Konto und alle Daten werden nach 30 Tagen endgültig gelöscht. Bis dahin kannst du dich anmelden und die Löschung zurücknehmen.</span>
      <button class="btn ghost danger-t" data-act="del-ask" style="border-color:var(--danger)">Konto löschen</button></section>`}`;
}
let FB = { kind: 'idee', meta: true };
function viewFeedback() {
  const K = { idee: ['Idee', 'Was fehlt dir in BUILT?', 'z. B. Ich hätte gern einen Timer für Supersätze'], fehler: ['Fehler', 'Was ist passiert? Was hast du davor gemacht?', 'z. B. Nach dem Speichern war der letzte Satz weg'], lob: ['Lob', 'Was gefällt dir?', 'z. B. Die Rekorde motivieren mich'] }, k = K[FB.kind];
  return `<h1 class="display" style="font-size:30px">Was können wir besser machen?</h1>
    <div class="seg" role="group" aria-label="Art">${Object.entries(K).map(([v, x]) => `<button data-act="fb-kind" data-v="${v}" aria-pressed="${FB.kind === v}">${x[0]}</button>`).join('')}</div>
    <label class="small muted" for="fb-text">${k[1]}</label>
    <textarea class="inp" id="fb-text" rows="7" maxlength="4000" placeholder="${esc(k[2])}"></textarea>
    <div class="rows glass"><label class="row tgl" style="cursor:pointer"><span style="display:flex;flex-direction:column;gap:2px"><span>App-Version und Gerät mitsenden</span><span class="small muted">${APP_VERSION} · ${/iPhone/.test(navigator.userAgent) ? 'iPhone' : 'Gerät'}. Hilft bei Fehlern.</span></span><input type="checkbox" role="switch" id="fb-meta" ${FB.meta ? 'checked' : ''}><i aria-hidden="true"></i></label></div>
    <span class="small muted">Dein Feedback wird mit deinem Konto gespeichert, damit wir nachfragen können. Keine Trainings- oder Chatinhalte.</span>
    <button class="btn primary" data-act="fb-send">Feedback senden</button>`;
}
async function exportData() {
  const r = await sb.rpc('export_my_data');
  if (r.error) { toast('Export hat nicht geklappt. Bitte später noch einmal.'); return; }
  const name = `BUILT-Export-${todayStr()}.json`;
  DATA.file = new File([JSON.stringify({ app: 'BUILT', version: APP_VERSION, created: new Date().toISOString(), data: r.data }, null, 2)], name, { type: 'application/json' });
  render();
}
async function shareData() {
  const f = DATA.file; if (!f) return;
  try { if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: 'BUILT-Export' }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
function deleteSheet() {
  sheet(`<h2>Konto wirklich löschen?</h2><ul class="dots"><li>Du wirst sofort abgemeldet und bist für Freunde nicht mehr sichtbar.</li>${isOwner() && crewMates().length ? '<li>Du verlässt die Crew, das älteste Mitglied wird Crew-Chef.</li>' : ''}<li>Innerhalb von 30 Tagen kannst du dich anmelden und die Löschung zurücknehmen. Danach ist alles endgültig weg.</li></ul>
    <div class="btnrow col"><button class="btn danger" data-act="del-yes">Ja, Konto löschen</button><button class="btn ghost" data-act="mclose">Abbrechen</button></div>`);
}

/* ---------- Plan-Builder ----------
   Oben Mein Plan / Crew-Plan, darunter die Trainingstage als Kürzel (bis zu 6), „+ Tag“ und der Stift für Name, Kürzel und Löschen.
   Änderungen am Crew-Plan gehen als Vorschlag an die Crew (Glocke), Mein Plan gilt nur für mich. */
let planKind = null;   // gewählter Plan im Plan-Tab, null = der aktuelle
const pkind = () => (planKind === 'crew' && !hasCrew() ? 'crew' : planKind || curPlan());
const builderDirty = () => !!builder && Object.values(builder.dirty).some(Boolean);
function ensureBuilder() {
  const k = pkind();
  if (builder && builder.kind === k && builderDirty()) return;
  const work = clone(planOf(cfg.me, k));
  const cur = builder && builder.kind === k && work[builder.day] ? builder.day : (draft && draft.plan === k && work[draft.day] ? draft.day : nextDay(cfg.me, k));
  builder = { kind: k, day: work[cur] ? cur : PD(work)[0], work, dirty: {} };
}
function viewPlan() {
  const k = pkind();
  const seg = `<div class="seg" role="group" aria-label="Plan"><button data-act="pkind" data-v="mine" aria-pressed="${k === 'mine'}">Mein Plan</button><button data-act="pkind" data-v="crew" aria-pressed="${k === 'crew'}">Crew-Plan</button></div>`;
  if (k === 'crew' && !hasCrew()) return `${seg}<section class="card nocrew"><h2>Du bist noch in keiner Crew</h2><p>Gründe eine mit deinen Buddies und trainiert nach einem gemeinsamen Plan.</p>
      <a class="btn primary" href="#crew-neu" style="width:100%">${ICON_CREW14.replace(/14/g, '20')}Crew gründen</a></section>
      <p class="small muted" style="margin:0 2px">Bis dahin trainierst du mit „Mein Plan“.</p>`;
  ensureBuilder();
  const b = builder, d = b.day, w = b.work[d], crew = k === 'crew';
  const days = PD(b.work);
  const chips = days.map(x => `<button class="dchip" data-act="bday" data-v="${x}" aria-pressed="${x === d}"><i style="background:${TONE_HEX[DAY_TONE[x]]}"></i>${esc(b.work[x].short || DAY_SHORT[x])}${b.dirty[x] ? '<span class="mark" aria-label="geändert"></span>' : ''}</button>`).join('')
    + (days.length < DAYS.length ? `<button class="dchip add" data-act="bday-add">+ Tag</button>` : '');
  const rows = w.exercises.map((x, i) => `<div class="prow">
      <div class="n"><b>${esc(x.name)}</b><span class="small muted">${TYPE_LABEL[x.type]} · ${x.sets}×${x.min}–${x.max}${isTimed(x.type) ? ' s' : ''}${x.type !== 'time' && x.step ? ` · +${fmtN(x.step)} kg` : ''}</span>
        ${(crew && x.personal) || x.warmup || libOwn(x.id) ? `<span class="tags">${crew && x.personal ? '<span class="tag">Nur ich</span>' : ''}${x.warmup ? '<span class="tag">Aufwärmsatz</span>' : ''}${libOwn(x.id) ? '<span class="tag">Eigene</span>' : ''}</span>` : ''}</div>
      <div class="tools"><button class="tool" data-act="bmove" data-i="${i}" data-v="-1" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button><button class="tool" data-act="bmove" data-i="${i}" data-v="1" aria-label="Nach unten" ${i === w.exercises.length - 1 ? 'disabled' : ''}>${ICON.down}</button></div>
      ${notesBlock(x.id, k)}
      <div class="acts"><button data-act="bedit" data-i="${i}">Bearbeiten</button><button data-act="breplace" data-i="${i}">Austauschen</button><button class="del" data-act="bremove" data-i="${i}">Entfernen</button></div>
    </div>`).join('');
  const changes = b.dirty[d] ? diffPlan(planOf(cfg.me, k)[d] || EMPTY_DAY, w, false) : [];
  const mates = crew ? (CREW.members || []).filter(p => p !== cfg.me) : [];
  return `${seg}
    <div class="dayrow"><div class="dscroll"><div class="rowc" role="group" aria-label="Trainingstag">${chips}</div></div><button class="iconbtn" data-act="bday-edit" aria-label="Trainingstag umbenennen" style="width:44px;height:44px">${ICON.pen || '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>'}</button></div>
    <div class="pbtns"><a class="btn ghost glass" href="#bibliothek">${ICON.book}Bibliothek</a><a class="btn ghost glass" href="#notizen:${k}">${ICON.note.replace('<svg ', '<svg width="20" height="20" ')}Notizen</a></div>
    <div class="dayt"><span class="day t-${DAY_TONE[d]}">${esc(w.short || DAY_SHORT[d])}</span><b>${esc(w.title)}</b></div>
    <section class="card" style="padding:4px 16px 16px">${rows || '<div class="empty">Noch keine Übungen an diesem Tag.</div>'}
      <button class="btn ghost" data-act="badd" style="margin-top:8px">+ Übung hinzufügen</button></section>
    ${crew && mates.length ? `<p class="small muted" style="margin:0 2px">${mates.map(nm).join(', ')} ${mates.length === 1 ? 'bekommt' : 'bekommen'} nur Änderungen an gemeinsamen Übungen gemeldet. Übungen mit „Nur ich“ lösen nie eine Meldung aus.</p>` : ''}
    ${changes.length ? `<section class="card"><b>Ungespeicherte Änderungen</b>${diffList(changes)}</section>` : ''}
    ${b.dirty[d] ? `<div style="height:56px"></div><div class="savebar"><span>${esc(w.short || DAY_SHORT[d])} geändert</span><button class="btn ghost" data-act="bdiscard">Verwerfen</button><button class="btn primary" data-act="bsave">Speichern</button></div>` : ''}`;
}
function markDirty() { builder.dirty[builder.day] = diffPlan(planOf(cfg.me, builder.kind)[builder.day] || EMPTY_DAY, builder.work[builder.day], false).length > 0; }
// Neuer Tag: nächste freie Kennung, Name und Kürzel gleich im Stift-Dialog
function addPlanDay() {
  const free = DAYS.find(x => !builder.work[x]); if (!free) return;
  const n = PD(builder.work).length + 1;
  builder.work[free] = { title: 'Tag ' + n, short: 'T' + n, exercises: [] };
  builder.day = free; builder.dirty[free] = true; dayEditSheet(true);
}
function dayEditSheet(isNew, askDel) {
  const b = builder, d = b.day, w = b.work[d], crew = b.kind === 'crew';
  const mates = crew && hasCrew() ? (CREW.members || []).filter(p => p !== cfg.me) : [];
  const canDel = PD(b.work).length > 1 && (planOf(cfg.me, b.kind)[d] || isNew);
  $('#modal').innerHTML = `<div class="backdrop" data-act="mclose-bg"><form class="sheet form tone-${DAY_TONE[d]}" id="dayform" role="dialog" aria-modal="true" aria-labelledby="rn-t" novalidate>
    <span class="eyebrow">${crew ? 'Crew-Plan' : 'Mein Plan'} · ${esc(w.short || DAY_SHORT[d])}</span>
    <h2 id="rn-t">${isNew ? 'Neuer Trainingstag' : 'Trainingstag umbenennen'}</h2>
    <div class="dayinputs"><label>Name<input class="inp" id="dn-title" value="${esc(w.title)}" maxlength="40"></label><label>Kürzel<input class="inp" id="dn-short" value="${esc(w.short || DAY_SHORT[d])}" maxlength="6" autocapitalize="characters"></label></div>
    <span class="help">${crew ? (mates.length ? `Wird mit deiner Crew abgeglichen. ${mates.map(nm).join(', ')} ${mates.length === 1 ? 'bekommt' : 'bekommen'} die Änderung über die Glocke.` : 'Wird mit deiner Crew abgeglichen.') : 'Gilt nur für deinen Plan.'}</span>
    <div class="err" id="dn-err" hidden></div>
    ${askDel ? `<div class="confirm"><b>${esc(w.short)} wirklich löschen?</b><span class="small muted">${crew ? 'Deine Crew bekommt die Änderung über die Glocke. ' : ''}Deine Trainings an diesem Tag bleiben im Verlauf.</span>
      <div class="btnrow"><button class="btn small danger" type="button" data-act="bday-del-yes">Ja, löschen</button><button class="btn small ghost" type="button" data-act="bday-del-no">Abbrechen</button></div></div>`
    : `<div class="btnrow col"><button class="btn primary" type="submit">${isNew ? 'Tag anlegen' : 'Speichern'}</button>${canDel && !isNew ? '<button class="btn ghost danger-t" type="button" data-act="bday-del">Tag löschen</button>' : ''}<button class="btn ghost" type="button" data-act="${isNew ? 'bday-cancel' : 'mclose'}">Abbrechen</button></div>`}
  </form></div>`;
  if (isNew) setTimeout(() => { const t = $('#dn-title'); if (t) t.select(); }, 30);
}
function submitDayForm() {
  const title = $('#dn-title').value.trim(), short = $('#dn-short').value.trim().toUpperCase();
  const err = m => { const e = $('#dn-err'); e.textContent = m; e.hidden = false; };
  if (!title) return err('Bitte gib dem Tag einen Namen.');
  if (!short) return err('Bitte gib ein Kürzel an, z. B. B&T.');
  const w = builder.work[builder.day]; w.title = title.slice(0, 40); w.short = short.slice(0, 6);
  closeModal(); markDirty(); savePlan();
}
function deletePlanDay() {
  const b = builder, d = b.day, k = b.kind;
  if (!planOf(cfg.me, k)[d]) { delete b.work[d]; delete b.dirty[d]; b.day = PD(b.work)[0]; closeModal(); render(); return; }
  if (PD(b.work).length < 2) return;
  const short = b.work[d].short || DAY_SHORT[d];
  addEvent('plan_change', { day: d, deleted: true, short, title: b.work[d].title, ...(k === 'mine' ? { plan: 'mine' } : {}) }, `${short} gelöscht`, { private: k === 'mine' });
  builder = null; closeModal(); toast(`${short} gelöscht`); render();
}
function savePlan() {
  const b = builder, d = b.day, w = b.work[d], k = b.kind;
  w.short = (w.short || '').trim() || DAY_SHORT[d];
  const before = planOf(cfg.me, k)[d] || EMPTY_DAY;
  const changes = diffPlan(before, w, false);
  if (!changes.length && planOf(cfg.me, k)[d]) { b.dirty[d] = false; render(); return; }
  if (k === 'mine') {
    addEvent('plan_change', { plan: 'mine', day: d, title: w.title, short: w.short, exercises: clone(w.exercises), changes, v2: true }, `Mein Plan: ${w.short} geändert`, { private: true });
    b.dirty[d] = false; toast(`${w.short} gespeichert.`); render(); return;
  }
  const mates = hasCrew() ? (CREW.members || []).filter(p => p !== cfg.me) : [];
  const notify = mates.some(p => sharedDiff(before, w).length > 0 && sharedDiff(st().plans[p][d] || EMPTY_DAY, w).length > 0);
  addEvent('plan_change', { day: d, title: w.title, short: w.short, exercises: clone(w.exercises), changes, v2: true }, `${w.short} geändert: ${changes.map(diffText).join('; ')}`);
  b.dirty[d] = false;
  toast(notify ? `${w.short} gespeichert. ${mates.length === 1 ? pname(mates[0]) + ' bekommt' : 'Deine Crew bekommt'} einen Hinweis.` : `${w.short} gespeichert.`);
  render();
}
const sheetHead = (eyebrow, title) => `<div class="shead"><button type="button" class="iconbtn" data-act="mclose" aria-label="Zurück ohne Speichern">${ICON.left}</button><span class="shead-t"><span class="eyebrow">${eyebrow}</span><b>${title}</b></span></div>`;
function exerciseForm(mode, i, keep) {
  const w = builder.work[builder.day], old = mode === 'add' ? null : w.exercises[i];
  if (!keep || !PK || PK.ctx !== 'plan') {
    PK = { ctx: 'plan', mode, i, x: mode === 'replace' ? old : null, day: builder.day, sel: mode === 'edit' ? old.id : '', q: '', group: mode === 'replace' ? 'Passend' : 'Alle', exclude: new Set(w.exercises.map(y => y.id)), vals: null };
  }
  PK.reopen = () => exerciseForm(mode, i, true);
  PK.onSel = L => planFormSel(L, true);
  const x = mode === 'edit' ? old : { sets: old ? old.sets : 3, min: old ? old.min : 8, max: old ? old.max : 12, step: old && !isTimed(old.type) ? old.step : 2.5, warmup: false, personal: old ? old.personal : false, image: '', type: old ? old.type : 'kg' };
  const title = mode === 'add' ? 'Neue Übung' : mode === 'edit' ? 'Übung im Plan' : 'Übung austauschen';
  const v = (k, d) => esc(pkVal(k, d));
  $('#modal').innerHTML = `<div class="backdrop" data-act="mclose-bg"><form class="sheet full form tone-${DAY_TONE[builder.day]}" id="exform" data-mode="${mode}" data-i="${i ?? ''}" novalidate>
    ${sheetHead(`${builder.kind === 'mine' ? 'Mein Plan' : 'Crew-Plan'} · ${esc(w.short || DAY_SHORT[builder.day])}`, title)}
    <h2>${title}</h2>
    ${mode === 'replace' ? `<p class="help" style="margin:0">Ersetzt <b>${esc(old.name)}</b>. Deren bisherige Einträge bleiben im Archiv erhalten.</p>` : ''}
    ${mode === 'edit' ? '' : pickBlock('Übung aus der Bibliothek')}
    <div id="pf-info"></div>
    <div class="grid3"><label>Sätze<input class="inp" id="f-sets" name="sets" inputmode="numeric" value="${v('sets', x.sets)}"></label>
      <label><span id="f-unit-min">${isTimed(x.type) ? 'Sek. von' : 'Wdh. von'}</span><input class="inp" id="f-min" name="min" inputmode="numeric" value="${v('min', x.min)}"></label>
      <label>bis<input class="inp" id="f-max" name="max" inputmode="numeric" value="${v('max', x.max)}"></label></div>
    <label class="chk" id="f-warm-l" ${x.type === 'kg' ? '' : 'hidden'}><input type="checkbox" id="f-warmup" name="warmup" ${pkVal('warmup', x.warmup ? 'on' : '') === 'on' ? 'checked' : ''}><span>Aufwärmsatz<small>Ein Satz mit 60 % × 6 vor den Arbeitssätzen.${builder.kind === 'crew' ? ' Wird mit deiner Crew abgeglichen.' : ''}</small></span></label>
    ${builder.kind === 'crew' ? `<label class="chk"><input type="checkbox" id="f-personal" name="personal" ${pkVal('personal', x.personal ? 'on' : '') === 'on' ? 'checked' : ''}><span>Abweichende Übung (nur ich)<small>Gehört nicht zum gemeinsamen Training und löst bei deiner Crew nie eine Meldung aus.</small></span></label>` : ''}
    <div class="persbox"><div class="eyebrow">Persönlich · wird nicht abgeglichen</div>
      <label id="f-step-l" ${isTimed(x.type) ? 'hidden' : ''}><span id="f-step-t">${x.type === 'bw' ? 'Steigerung Zusatzgewicht in kg (0 = keine)' : 'Steigerung in kg'}</span><input class="inp" id="f-step" name="step" inputmode="decimal" value="${v('step', fmtIn(x.step || 0))}"><span class="help">${isBarbell(x) ? 'Langhantel: immer genau diese Stufe, mindestens 2,5 kg.' : 'Eine Stufe mehr, wenn ein Satz die obere Wdh.-Zahl locker oder zweimal mit „passt“ schafft.'}</span>${(() => { const lst = learnedStep(cfg.me, x); return lst > (x.step || 0) ? `<span class="help">Gelernt aus euren Einträgen: <b style="color:var(--fg)">${fmtN(lst)} kg</b>. Die App nimmt die größere Stufe. <button type="button" class="lnk" data-act="step-adopt" data-v="${lst}" style="padding:0;font-size:13px">${fmtN(lst)} kg übernehmen</button></span>` : ''; })()}</label>
      <label>Bild-Link (optional)<input class="inp" id="f-image" name="image" type="url" inputmode="url" value="${v('image', x.image || '')}" placeholder="https://…/bild.jpg"></label>
    </div>
    <div class="err" id="f-err" hidden></div>
    <div class="sbar"><button class="btn primary" type="submit">${mode === 'replace' ? 'Austauschen' : 'Übernehmen'}</button></div>
  </form></div>`;
  if (mode !== 'edit') renderPick();
  planFormSel(libGet(PK.sel), false);
}
// Gewählte Übung im Plan-Formular: Art, Muskeln, Ausführung aus der Bibliothek, Spanne als Vorschlag
function planFormSel(L, fill) {
  const box = $('#pf-info'); if (!box) return;
  if (!L) { box.innerHTML = ''; return; }
  const tk = DAY_TONE[builder.day], timed = isTimed(L.type);
  box.innerHTML = `<div class="pfinfo"><div class="rowbetween"><b>${esc(L.name)}</b><span class="tag" style="margin:0">${TYPE_LABEL[L.type]}</span></div>
    ${musPreview({ p: L.p, s: L.s }, tk)}
    <span class="small ${L.cue ? 'muted' : 'warn-t'}">${L.cue ? esc(L.cue) : 'Noch keine Ausführungshinweise hinterlegt.'}</span>
    <button type="button" class="btn small ghost" data-act="lib-edit" data-id="${esc(L.id)}" style="align-self:flex-start">${L.owner === cfg.me ? 'Eigene Übung bearbeiten' : 'In der Bibliothek ansehen'}</button></div>`;
  if (fill && PK.mode !== 'edit') { $('#f-sets').value = L.sets; $('#f-min').value = L.min; $('#f-max').value = L.max; if (timed) $('#f-step').value = '0'; else if (!num($('#f-step').value)) $('#f-step').value = fmtIn(2.5); }
  $('#f-unit-min').textContent = timed ? 'Sek. von' : 'Wdh. von';
  $('#f-warm-l').hidden = L.type !== 'kg';
  $('#f-step-l').hidden = timed;
  $('#f-step-t').textContent = L.type === 'bw' ? 'Steigerung Zusatzgewicht in kg (0 = keine)' : 'Steigerung in kg';
}
function submitExercise(form) {
  const f = new FormData(form), mode = form.dataset.mode, i = +form.dataset.i;
  const w = builder.work[builder.day], old = mode === 'add' ? null : w.exercises[i];
  const err = m => { const e = $('#f-err'); e.textContent = m; e.hidden = false; e.scrollIntoView({ block: 'center' }); };
  const L = libGet(PK && PK.sel);
  if (!L) return err('Bitte wähle eine Übung aus der Bibliothek oder erstelle eine neue.');
  const sets = int(f.get('sets')), min = int(f.get('min')), max = int(f.get('max'));
  if (!sets || sets > 10) return err('Sätze: bitte eine Zahl von 1 bis 10.');
  if (!min || !max || min > max) return err('Bitte gib eine gültige Spanne an, z. B. 8 bis 12.');
  if (w.exercises.some((y, k) => y.id === L.id && !(mode !== 'add' && k === i))) return err(`${L.name} ist schon in diesem Trainingstag.`);
  const data = { id: L.id, name: L.name, type: L.type, sets, min, max, step: isTimed(L.type) ? 0 : Math.max(0, num(f.get('step'))), cue: L.cue, video: L.video, image: safeUrl(f.get('image')), warmup: L.type === 'kg' && f.get('warmup') === 'on', personal: f.get('personal') === 'on', muscles: { p: L.p.slice(), s: L.s.slice() } };
  if (mode === 'edit') Object.assign(w.exercises[i], data);
  else if (mode === 'add') w.exercises.push(data);
  else w.exercises.splice(i, 1, { ...data, replaces: old.id });
  PK = null; $('#modal').innerHTML = ''; markDirty(); render();
}
/* ---------- Einstellungen & Einrichtung ---------- */
/* ---------- Über BUILT und Rechtliches (Platzhalter, werden vor einem öffentlichen Start überarbeitet) ---------- */
function viewAbout() {
  const row = (k, l) => `<a class="row" href="#rechtliches:${k}">${l}<span class="v">›</span></a>`;
  return `<div class="about-top"><img src="${FLAME.W}" alt=""><span><b class="display" style="font-size:24px">BUILT</b><br><span class="mono small muted">Version ${APP_VERSION}</span></span></div>
    <div class="secl">Rechtliches</div>
    <div class="rows glass">${row('impressum', 'Impressum')}${row('datenschutz', 'Datenschutzerklärung')}${row('nutzung', 'Nutzungsbedingungen')}${LEGAL.report ? `<a class="row" href="mailto:${esc(LEGAL.report)}">Inhalte melden<span class="v">${esc(LEGAL.report)}</span></a>` : ''}</div>
    <div class="secl">Deine Daten</div>
    <div class="rows glass"><a class="row" href="#privatsphaere">Einwilligungen verwalten<span class="v">›</span></a><a class="row" href="#daten">Meine Daten exportieren<span class="v">›</span></a><a class="row" href="#daten" style="color:var(--danger)">Konto löschen<span class="v">›</span></a></div>
    <div class="secl">Lizenzen</div>
    <section class="card"><b>Schriften: Unbounded, Geist, Geist Mono</b><span class="small muted">SIL Open Font License 1.1. Die Schriften sind in der App enthalten und werden nicht von fremden Servern geladen.</span><a class="lnk" href="#rechtliches:lizenzen" style="align-self:flex-start">Lizenztexte anzeigen</a></section>`;
}
function viewLegal(k) {
  const who = `${esc(LEGAL.name)}${LEGAL.street ? '<br>' + esc(LEGAL.street) : ''}${LEGAL.city ? '<br>' + esc(LEGAL.city) : ''}<br>Deutschland`;
  const mail = LEGAL.mail ? `<a href="mailto:${esc(LEGAL.mail)}">${esc(LEGAL.mail)}</a>` : '–';
  const T = {
    impressum: ['Impressum', `<h3>Angaben gemäß § 5 DDG</h3><p>${who}</p>
      <h3>Kontakt</h3><p>E-Mail: ${mail}${LEGAL.phone ? `<br>Telefon: <a href="tel:${esc(LEGAL.phone.replace(/\s/g, ''))}">${esc(LEGAL.phone)}</a>` : ''}</p>
      <h3>Zentrale Kontaktstelle nach Digital Services Act</h3><p>Für Behörden und Nutzer: ${LEGAL.report ? esc(LEGAL.report) : mail}. Wir antworten auf Deutsch oder Englisch.</p>
      <h3>Inhalte melden</h3><p>Rechtswidrige Inhalte kannst du direkt in der App über „Melden“ bei einer Nachricht, einer Notiz oder einem Profil melden.</p>
      <h3>Verbraucherstreitbeilegung</h3><p>Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
      <h3>Haftung für Inhalte</h3><p>Für Inhalte, die Nutzer teilen (Chats, Spots, Notizen, Profile), sind die jeweiligen Nutzer verantwortlich. Sobald wir von einem Rechtsverstoß erfahren, entfernen wir den Inhalt.</p>`],
    datenschutz: ['Datenschutz', `<h3>1. Verantwortlicher</h3><p>Siehe Impressum.<br>E-Mail: ${mail}</p>
      <h3>2. Welche Daten wir verarbeiten</h3><p><b>Konto:</b> E-Mail-Adresse, Anzeigename, GymBuddy-ID, optional Profilbild, Wochenziel. <b>Training:</b> Pläne, Sätze, Gewichte, Notizen, Flammen, eigene Übungen. <b>Soziales:</b> Freundschaften, Crew-Mitgliedschaft, Reaktionen, Meldungen. <b>Chats, Spots und Vault</b> speichern wir nur verschlüsselt, wir können sie nicht lesen. Meldest du eine Nachricht, wird sie zur Prüfung lesbar mitgeschickt.</p>
      <h3>3. Gesundheitsdaten</h3><p>Körpergewicht und Fortschrittsbilder im Vault sind Gesundheitsdaten (Art. 9 DSGVO). Wir speichern sie nur mit deiner ausdrücklichen Einwilligung, die du jederzeit unter Einstellungen → Privatsphäre widerrufen kannst. Dein Körpergewicht sehen andere nur, wenn du es freigibst.</p>
      <h3>4. Rechtsgrundlagen</h3><p>Vertrag (Art. 6 Abs. 1 lit. b DSGVO) für Konto, Training und Buddys; Einwilligung (Art. 6 Abs. 1 lit. a, Art. 9 Abs. 2 lit. a DSGVO) für Gesundheitsdaten und Nutzungsstatistik; berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO) für Sicherheit, Missbrauchsschutz und Fehlerprotokolle ohne Inhalte.</p>
      <h3>5. Dienstleister</h3><p><b>Supabase</b> (Datenbank, Anmeldung, Dateispeicher), Server in Frankfurt am Main (EU). <b>Brevo</b> (Sendinblue GmbH, Berlin) verschickt die Anmelde-Codes per E-Mail. <b>GitHub Pages</b> (GitHub Inc., USA) liefert die App-Dateien aus; dabei verarbeitet GitHub technisch deine IP-Adresse. <b>ImprovMX</b> (ImprovMX Inc., Dover, USA) leitet E-Mails an ${esc(LEGAL.mail)} an unser Postfach weiter; die Mails werden in Frankreich (Paris) angenommen und nach der Zustellung gelöscht. Für Übermittlungen außerhalb der EU gelten die EU-Standardvertragsklauseln.</p>
      <h3>6. Speicherdauer</h3><p>Chats 30 Tage, Spots bis sie gesehen wurden, höchstens 30 Tage. Nutzungsstatistik 90 Tage, Fehlerprotokolle 30 Tage. Trainingsdaten, bis du sie oder dein Konto löschst. Nach einem Löschantrag wird dein Konto nach 30 Tagen endgültig gelöscht.</p>
      <h3>7. Kein Tracking</h3><p>Keine Werbung, keine fremden Analyse-Tools, keine Weitergabe an Dritte. Die Nutzungsstatistik ist freiwillig, anonym und enthält keine Inhalte.</p>
      <h3>8. Deine Rechte</h3><p>Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit (Export unter „Deine Daten“), Widerspruch und Widerruf von Einwilligungen. Du kannst dich bei einer Datenschutz-Aufsichtsbehörde beschweren, zum Beispiel beim Unabhängigen Landeszentrum für Datenschutz Schleswig-Holstein.</p>`],
    nutzung: ['Nutzungsbedingungen', `<h3>Respekt</h3><p>Keine Beleidigungen, keine Hetze, keine verbotenen Symbole oder Kürzel, weder im Namen noch in Chats, Notizen oder Spots.</p>
      <h3>Melden und Sperren</h3><p>Gemeldete Inhalte werden geprüft. Wer gegen die Regeln verstößt, kann gesperrt werden.</p>
      <h3>Training</h3><p>BUILT ersetzt keine Trainer- oder ärztliche Beratung. Du trainierst auf eigene Verantwortung.</p>
      <h3>Konto</h3><p>Ein Konto pro Person. Du kannst es jederzeit unter „Deine Daten“ löschen.</p>`],
    lizenzen: ['Lizenzen', `<h3>Unbounded</h3><p>Copyright The Unbounded Project Authors. SIL Open Font License 1.1.</p>
      <h3>Geist und Geist Mono</h3><p>Copyright The Geist Project Authors. SIL Open Font License 1.1.</p>
      <h3>supabase-js</h3><p>Copyright Supabase. MIT License.</p>
      <h3>QR Code Generator</h3><p>Copyright (c) 2009 Kazuhiko Arase. MIT License. „QR Code“ ist eine eingetragene Marke der DENSO WAVE INCORPORATED.</p>
      <h3>jsQR</h3><p>Copyright Cosmo Wolfe. Apache License 2.0.</p>
      <p>Die vollständigen Lizenztexte liegen der App in den Ordnern „fonts“ und „vendor“ bei.</p>`]
  };
  const x = T[k] || T.impressum;
  return `<h1 class="display" style="font-size:30px">${x[0]}</h1>${x[1]}`;
}
function viewSettings() {
  const waiting = pending.filter(p => !seenIds.has(p.id)).length;
  const hasVault = !!vmeta();
  return `<h1 class="display" style="font-size:30px">Einstellungen</h1>
    <div class="secl">Profil</div>
    <div class="rows glass"><label class="row" style="min-height:72px">${avatar(cfg.me, 46)}<span style="display:flex;flex-direction:column"><b>${nm(cfg.me)}</b><span class="small muted">Profilbild sehen deine Buddies</span></span><span class="v" style="color:var(--fg);font-family:var(--body);font-weight:600">Ändern</span><input type="file" id="av-file2" accept="image/*" hidden></label>
      <button class="row" data-act="kurz-open">Kürzel im Kalender<span class="v">${esc(kurzMap()[cfg.me] || '–')}${(PROFILES[cfg.me] || {}).kurz ? '' : ' · automatisch'}</span></button></div>
    <div class="secl">Vault</div>
    <div class="rows glass">
      ${hasVault ? `<button class="row" data-act="v-change">Vault-Code ändern<span class="v">• • • •</span></button>
      <button class="row" data-act="v-showkey">Wiederherstellungsschlüssel<span class="v"${vmeta().saved ? '' : ' style="color:var(--warn)"'}>${vmeta().saved ? 'anzeigen' : 'noch nicht notiert'}</span></button>
      <div class="row">Sicherung im Konto<span class="v">${vaultCloudText()}</span></div>
      <button class="row" data-act="v-export">Backup als Datei<span class="v">sichern</span></button>
      <a class="row" href="#vault-wiederherstellen">Mit anderem Schlüssel wiederherstellen<span class="v">ersetzen</span></a>` : `<a class="row" href="#vault">Vault einrichten<span class="v">Code festlegen</span></a>
      <a class="row" href="#vault-wiederherstellen">Vault wiederherstellen<span class="v">mit Schlüssel</span></a>`}
      <label class="row">Backup-Datei laden<span class="v">Datei wählen</span><input type="file" id="v-import" accept="application/json,.json" hidden></label>
    </div>
    <div class="secl">Konto</div>
    <div class="rows glass">
      <div class="row">E-Mail<span class="v">${esc(LS.get('acct.email', '') || '–')}</span></div>
      ${PROFILES[cfg.me] && PROFILES[cfg.me].buddy_id ? `<button class="row" data-act="acct-copy">Buddy-ID<span class="v mono">#${esc(PROFILES[cfg.me].buddy_id)}</span></button>` : ''}
      <label class="row tgl" style="cursor:pointer"><span>Körpergewicht mit Buddys teilen</span><input type="checkbox" role="switch" id="share-w" ${(PROFILES[cfg.me] || {}).share_weight ? 'checked' : ''}><i aria-hidden="true"></i></label>
      <div class="row">Letzter Sync<span class="v">${lastSync ? fmtDate(lastSync) + ', ' + fmtTime(lastSync) : '–'}</span></div>
      <div class="row">Einträge<span class="v">${events.length} synchronisiert, ${waiting} wartend</span></div>
    </div>
    <div class="secl">Daten und Hilfe</div>
    <div class="rows glass"><a class="row" href="#privatsphaere">Privatsphäre<span class="v">›</span></a><a class="row" href="#daten">Deine Daten<span class="v">Export, Löschen</span></a><a class="row" href="#feedback">Feedback geben<span class="v">›</span></a></div>
    <div class="secl">Über BUILT</div>
    <div class="rows glass"><a class="row" href="#ueber">Impressum, Datenschutz, Lizenzen<span class="v">Version ${APP_VERSION}</span></a></div>
    <div class="secl">Gerät</div>
    <section class="card"><b>Daten auf diesem Handy zurücksetzen</b>
      <span class="small muted">Löscht nur die Kopie des Trainingslogs auf diesem Handy. Beim nächsten Sync wird alles aus deinem Konto neu geladen. Der Vault bleibt erhalten.${waiting ? ` <b>${waiting} noch nicht gesendete Einträge gehen dabei verloren.</b>` : ''}</span>
      ${resetAsk ? `<div class="btnrow"><button class="btn small danger" data-act="reset-yes">Ja, zurücksetzen</button><button class="btn small ghost" data-act="reset-no">Abbrechen</button></div>` : `<button class="btn danger" data-act="reset-ask">Zurücksetzen</button>`}
    </section>
    <section class="card"><b>Abmelden</b>
      <span class="small muted">Meldet dieses Handy von deinem Konto ab und entfernt deine Trainingsdaten und Chats von diesem Handy. In deinem Konto bleibt alles erhalten. Der Vault bleibt verschlüsselt auf dem Handy.${waiting ? ` <b>${waiting} noch nicht gesendete Einträge gehen dabei verloren.</b>` : ''}</span>
      ${logoutAsk ? `<div class="btnrow"><button class="btn small danger" data-act="logout-yes">Ja, abmelden</button><button class="btn small ghost" data-act="logout-no">Abbrechen</button></div>` : `<button class="btn ghost" data-act="logout-ask">Abmelden</button>`}
    </section>`;
}
const musOpen = new Set();
document.addEventListener('toggle', e => { const d = e.target; if (d && d.matches && d.matches('details.mus')) { if (d.open) musOpen.add(d.dataset.ex); else musOpen.delete(d.dataset.ex); } }, true);
function vaultCloudText() {
  const m = vmeta(), c = vcloud();
  if (!m || m.v !== 2) return 'nach dem nächsten Öffnen';
  if (vaultSyncing) return 'läuft …';
  if (!c) return 'noch nicht gesichert';
  if (c.err) return c.err === 'network' || c.err === 'offline' ? 'offline, folgt' : 'zuletzt fehlgeschlagen';
  return `${c.n} ${c.n === 1 ? 'Bild' : 'Bilder'} · ${fmtDate(c.at)}, ${fmtTime(c.at)}`;
}
/* ---------- Anmeldung (ab 3.0) ----------
   E-Mail → 6-stelliger Code → (einmalig: Übernahme des alten Profils) → Zu dir → Wochenziel → Datenschutz → Buddy-ID.
   Der Fortschritt liegt in ONB und überlebt ein Neuladen. Fertig ist man, wenn cfg.me gesetzt ist. */
const ONB = Object.assign({ step: 'welcome', email: '', code: '', err: '', busy: false, legacy: null, claim: null, name: '', goal: 3, ok: false, buddy: '' }, LS.get('onb', {}));
const onbSave = () => LS.set('onb', { step: ONB.step, email: ONB.email, claim: ONB.claim, name: ONB.name, goal: ONB.goal, buddy: ONB.buddy });
const onbGo = step => { ONB.step = step; ONB.err = ''; ONB.busy = false; onbSave(); render(); setTimeout(() => { const i = $('#onb-in'); if (i) i.focus(); }, 60); };
// 2.2.1-Gerät: cfg.me war ein Name („Manu“). Alte Einstellungen für die Übernahme beiseitelegen.
(() => { if (cfg.me && cfg.me.length < 20) { LS.set('legacy.cfg', { name: cfg.me, url: cfg.url, key: cfg.key }); cfg = { me: null }; LS.set('cfg', cfg); } })();
const onbSegs = (n, total = 6) => `<div class="segs" role="progressbar" aria-label="Schritt ${n} von ${total}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${n - 1}">${Array.from({ length: total }, (_, i) => `<i class="${i + 1 < n ? 'on' : i + 1 === n ? 'cur' : ''}"></i>`).join('')}</div>`;
const onbHead = (back, n) => `<div class="onb-head">${back ? `<button class="iconbtn" data-act="onb-back" data-v="${back}" aria-label="Zurück">${ICON.left}</button>` : ''}${n ? onbSegs(n) : `<span class="eyebrow" style="flex:1">Einmalig</span>`}</div>`;
const onbErr = () => ONB.err ? `<div class="err" role="alert">${esc(ONB.err)}</div>` : '';
const onbBtn = (act, label, dis) => `<button class="btn primary" data-act="${act}" ${dis || ONB.busy ? 'disabled' : ''}>${ONB.busy ? 'Moment …' : label}</button>`;
function viewSetup() {
  const s = ONB.step;
  if (s === 'welcome') return `<div class="onb onb-welcome"><div class="onb-body center">
      <img src="flammen/flamme-hero-woche.webp" alt="" class="onb-hero"><h1 class="display" style="font-size:64px;letter-spacing:-.04em">BUILT</h1>
      <p class="muted" style="margin:0;max-width:280px">Trainiere mit deiner Crew. Halte jeden Satz fest. Halte die Flamme am Brennen.</p></div>
    <div class="onb-cta"><p>Kein Passwort nötig. Du bekommst einen Code per Mail.</p><button class="btn primary" data-act="onb-go" data-v="email">${ICON.mail || ''}Mit E-Mail fortfahren</button>
      <div class="onb-legal"><a href="#rechtliches:impressum">Impressum</a><a href="#rechtliches:datenschutz">Datenschutz</a></div></div></div>`;
  if (s === 'email') return `<div class="onb">${onbHead('welcome', 1)}<div class="onb-body">
      <h1 class="display">Wie lautet deine E-Mail?</h1><p class="muted" style="margin:-8px 0 0">Deine Adresse sieht niemand außer dir, auch deine Freunde nicht.</p>
      <label class="lbl">E-Mail-Adresse<input class="inp" id="onb-in" type="email" value="${esc(ONB.email)}" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" data-onb="email"></label>${onbErr()}</div>
    <div class="onb-cta"><p>Neu hier oder schon dabei: Der Weg ist derselbe.</p>${onbBtn('onb-send', 'Code senden')}</div></div>`;
  if (s === 'code') return `<div class="onb">${onbHead('email', 2)}<div class="onb-body">
      <h1 class="display">Code eingeben</h1><p class="muted" style="margin:-8px 0 0">Wir haben einen Code an <b style="color:var(--fg)">${esc(ONB.email)}</b> geschickt. Er ist 10 Minuten gültig.</p>
      <label class="otpwrap"><span class="otpboxes" aria-hidden="true">${Array.from({ length: 6 }, (_, i) => `<span class="codebox${i === ONB.code.length ? ' cur' : ''}">${esc(ONB.code[i] || '')}</span>`).join('')}</span>
        <input id="onb-in" class="otp" data-onb="code" value="${esc(ONB.code)}" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-label="6-stelliger Code"></label>${onbErr()}
      <div class="onb-links"><button class="lnk" data-act="onb-send">Code erneut senden</button><button class="lnk" data-act="onb-go" data-v="email">Andere E-Mail</button></div></div>
    <div class="onb-cta">${onbBtn('onb-verify', 'Weiter', ONB.code.length !== 6)}</div></div>`;
  if (s === 'claim') return `<div class="onb">${onbHead('', 0)}<div class="onb-body">
      <h1 class="display">Schon mit BUILT trainiert?</h1><p class="muted" style="margin:0">Wenn du BUILT schon vor den Konten benutzt hast, holst du dir hier alles zurück: Trainings, Pläne, Notizen, Vault und Chats.</p>
      <label class="lbl">Übernahme-Code<input class="inp mono" id="onb-in" data-onb="claim" placeholder="z. B. 7KQ2 M9XA" autocapitalize="characters" autocomplete="off" spellcheck="false" style="letter-spacing:.12em;text-transform:uppercase"></label>
      <p class="small muted" style="margin:0">Der Code funktioniert nur einmal.</p>${onbErr()}</div>
    <div class="onb-cta">${onbBtn('onb-claim', 'Übernehmen')}<button class="btn ghost" data-act="onb-go" data-v="profile">Nein, neu starten</button></div></div>`;
  if (s === 'claimok') { const c = ONB.claim || {}; const li = (t, x) => `<div class="onb-li">${ICON.check}<span><b>${t}</b> <span class="muted">${x}</span></span></div>`;
    return `<div class="onb">${onbHead('', 0)}<div class="onb-body">
      <h1 class="display">Willkommen zurück, ${esc(c.name || '')}</h1>
      <section class="card">${li(`${c.workouts || 0} Trainings`, 'mit Plänen, Notizen und Körpergewicht')}${c.vault || c.gallery ? li('Vault und Galerie', 'öffnest du mit deinem bisherigen Code') : ''}${c.chats ? li('Chats', 'werden beim ersten Öffnen neu verschlüsselt') : ''}${li('Crew', c.crew ? 'steht, ihr seid wieder zusammen' : 'sobald dein Buddy seinen Code eingegeben hat')}</section>
      <p class="small muted" style="margin:0">Name und Profilbild sind schon eingetragen. Du kannst sie im nächsten Schritt ändern.</p></div>
    <div class="onb-cta"><button class="btn primary" data-act="onb-go" data-v="profile">Weiter</button></div></div>`; }
  if (s === 'profile') { const n = ONB.name.trim(), okN = nameOk(ONB.name);
    return `<div class="onb">${onbHead('', 3)}<div class="onb-body">
      <h1 class="display">Zu dir</h1>
      <div class="pf" style="align-self:center">${avatarBig()}</div>
      <label class="lbl">Dein Name<input class="inp" id="onb-in" data-onb="name" value="${esc(ONB.name)}" maxlength="24" autocomplete="nickname"></label>
      <p class="small ${n && !okN ? 'err' : 'muted'}" style="margin:-6px 0 0">${n && !okN ? 'Nur Buchstaben und Zahlen, 2 bis 24 Zeichen, höchstens ein Leerzeichen.' : 'So sehen dich deine Buddys. Buchstaben und Zahlen, ein Leerzeichen ist erlaubt.'}</p>${onbErr()}</div>
    <div class="onb-cta"><p>Name und Bild kannst du später jederzeit im Profil ändern.</p>${onbBtn('onb-name', 'Weiter', !okN)}</div></div>`; }
  if (s === 'goal') return `<div class="onb">${onbHead('profile', 4)}<div class="onb-body">
      <h1 class="display" style="font-size:40px">Dein<br>Wochenziel</h1>
      <div class="onb-goal"><img src="flammen/flamme-hero-woche.webp" alt=""><p class="muted">Schaffst du <b style="color:var(--fg)">${ONB.goal === 1 ? '1 Training' : ONB.goal + ' Trainings'}</b> in einer Woche, gibt es die Wochenflamme. Du kannst dein Ziel jederzeit im Profil ändern.</p></div>
      <div class="wz" role="radiogroup" aria-label="Trainings pro Woche">${[1, 2, 3, 4, 5, 6].map(k => `<button role="radio" aria-checked="${k === ONB.goal}" class="wzb${k === ONB.goal ? ' on' : ''}" data-act="onb-goal" data-v="${k}">${k}</button>`).join('')}</div>${onbErr()}</div>
    <div class="onb-cta">${onbBtn('onb-goalok', 'Weiter')}</div></div>`;
  if (s === 'privacy') return `<div class="onb">${onbHead('goal', 5)}<div class="onb-body">
      <h1 class="display">Deine Daten bleiben deine</h1>
      <section class="card onb-facts"><div><b>Gespeichert in der EU.</b> <span class="muted">Server in Frankfurt.</span></div><div><b>Chats, Spots und Vault verschlüsselt.</b> <span class="muted">Nur du und die Empfänger können sie lesen.</span></div><div><b>Kein Tracking, keine Werbung.</b></div><div><b>Export und Löschen</b> <span class="muted">jederzeit in den Einstellungen.</span></div></section>
      <p class="small muted" style="margin:0">Körpergewicht und Vault-Bilder gelten als Gesundheitsdaten. Dafür fragen wir dich gesondert, sobald du sie zum ersten Mal nutzt.</p>
      <label class="chk onb-chk"><input type="checkbox" data-onb="ok" ${ONB.ok ? 'checked' : ''}><span>Ich habe die <a href="#rechtliches:datenschutz">Datenschutzerklärung</a> und die <a href="#rechtliches:nutzung">Nutzungsbedingungen</a> gelesen und bin einverstanden.</span></label>${onbErr()}</div>
    <div class="onb-cta"><p>Danach bekommst du deine GymBuddy-ID.</p>${onbBtn('onb-privacy', 'Konto erstellen', !ONB.ok)}</div></div>`;
  if (s === 'buddy') return `<div class="onb">${onbHead('', 6)}<div class="onb-body">
      <h1 class="display">Deine GymBuddy-ID</h1><p class="muted" style="margin:0">Damit finden dich Freunde in BUILT. Teile sie oder lass deinen QR-Code im Profil scannen.</p>
      <button class="buddyid" data-act="onb-copy"><span class="mono">#${esc(ONB.buddy)}</span>${ICON.copy || ''}</button></div>
    <div class="onb-cta"><button class="btn ghost" data-act="onb-done" data-v="later">Später</button><button class="btn primary" data-act="onb-done" data-v="buddies">Ersten GymBuddy hinzufügen</button></div></div>`;
  return '';
}
// Name: 2–24 Zeichen, Buchstaben (auch Umlaute) und Ziffern, höchstens ein Leerzeichen, nicht am Rand
const nameOk = v => { const t = String(v || ''); return t === t.trim() && /^[\p{L}\d]+( [\p{L}\d]+)?$/u.test(t) && [...t].length >= 2 && [...t].length <= 24; };
const avatarBig = () => `<span class="av onb-av" style="background:#7d7740">${esc((ONB.name.trim()[0] || '?').toUpperCase())}</span>`;
const sbMsg = e => { const m = String((e && (e.message || e.msg)) || ''); if (/Code passt nicht/.test(m)) return 'Der Code passt nicht. Prüfe ihn noch einmal.'; if (/Zu viele/.test(m)) return m; if (/expired|invalid/i.test(m)) return 'Der Code stimmt nicht oder ist abgelaufen.'; if (/rate|seconds/i.test(m)) return 'Bitte warte kurz, bevor du einen neuen Code anforderst.'; if (/valid_name|check constraint/i.test(m)) return 'Dieser Name ist nicht erlaubt. Bitte wähle einen anderen.'; if (/fetch|network/i.test(m)) return 'Keine Verbindung. Prüfe dein Internet.'; return m || 'Das hat nicht geklappt.'; };
async function onbAfterLogin() {
  const { data: u } = await sb.auth.getUser(); const id = u && u.user && u.user.id; if (!id) throw new Error('Anmeldung fehlgeschlagen');
  const p = (await sb.from('profiles').select('*').eq('id', id).maybeSingle()).data || {};
  ONB.uid = id; ONB.buddy = p.buddy_id || ''; if (!ONB.name) ONB.name = p.name || '';
  const consent = (await sb.from('consents').select('kind').eq('kind', 'privacy').limit(1)).data;
  if (p.name && consent && consent.length) return onbFinish(id, 'later', true);   // bekanntes Konto, neues Gerät
  const open = !p.legacy_name && (await sb.rpc('legacy_open')).data === true;
  if (open) return onbGo('claim');
  onbGo('profile');
}
// Lokale Daten eines 2.2.1-Geräts auf die neue Profil-ID umziehen (Vault-Schlüssel, Galerie, Entwurf)
function onbMoveLocal(old, id) {
  ['vault.', 'vault.tok.', 'vault.cloud.', 'vault.tomb.', 'gal.key.', 'gal.tomb.', 'spot.tomb.', 'chat.hidden.', 'chat.msgs.', 'chat.read.'].forEach(k => {
    const v = localStorage.getItem('hb.' + k + old); if (v != null && localStorage.getItem('hb.' + k + id) == null) localStorage.setItem('hb.' + k + id, v);
  });
  // noch nicht gesendete eigene Einträge aus 2.2.1 behalten
  pending = pending.filter(p => p.person === old).map(p => ({ ...p, person: id }));
  events = []; seenIds = new Set(); lastSeq = 0; saveLog();
}
async function onbFinish(id, next, known) {
  const old = LS.get('legacy.cfg', null);
  if (old && old.name) onbMoveLocal(old.name, id); else { events = []; seenIds = new Set(); lastSeq = 0; pending = []; saveLog(); }
  cfg = { me: id, url: SB_URL, key: 'supabase' }; LS.set('cfg', cfg); computePeople(); LS.set('onb', {}); Object.assign(ONB, { step: 'welcome', code: '', err: '' });
  location.hash = next === 'buddies' ? '#buddies' : '#start';
  invalidate(); render(); await sync({ overlay: true });
  if ((PROFILES[id] || {}).deleted_at) { location.hash = '#daten'; toast('Für dein Konto ist eine Löschung beantragt.'); return; }
  if (known) toast('Willkommen zurück');
}

/* ---------- Ereignisse ---------- */
const readSetInputs = (i, j) => {
  const s = draft.items[i].sets[j], rIn = document.getElementById(`r-${i}-${j}`), wIn = document.getElementById(`w-${i}-${j}`);
  if (wIn && !wIn.readOnly) s.w = wIn.value; if (rIn && !rIn.readOnly) s.r = rIn.value; return s;   // laufender Timer zeigt die Restzeit, nicht den Wert
};
// Körpergewichtsübungen: Seite (+/−) und Wert gehen an die Sätze darunter, die noch leer, nicht abgehakt und nicht selbst geändert sind
function propagateDown(i, j) {
  const it = draft.items[i], src = it.sets[j]; let changed = false;
  for (let k = j + 1; k < it.sets.length; k++) {
    const s = it.sets[k];
    if (s.done || int(s.r) || s.man) continue;
    if (s.w !== src.w || s.neg !== src.neg || s.alt !== src.alt) { s.w = src.w; s.neg = src.neg; s.alt = src.alt; s.mk = ''; s.lab = ''; changed = true; }
  }
  return changed;
}
const actions = {
  'to-flames': () => { const el = $('#flammen'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  'fl-toggle': t => { const p = t.dataset.p; if (FLAME_OPEN.has(p)) FLAME_OPEN.delete(p); else FLAME_OPEN.add(p); render(); },
  'feed-rec': (t, e) => { e.preventDefault(); e.stopPropagation(); const id = t.dataset.id; if (FEED_OPEN.has(id)) FEED_OPEN.delete(id); else FEED_OPEN.add(id); render(); },
  'cm-react': t => { chatReact(t.dataset.id, t.dataset.v); closeModal(); },
  'cm-emoji': t => openChatMenu(t.dataset.id, true),
  'cm-reply': t => { CHAT.reply = { p: CHAT.open, id: t.dataset.id }; closeModal(); refreshReplyBar(); const i = $('#chat-in'); if (i) i.focus(); },
  'cm-reply-x': () => { CHAT.reply = null; refreshReplyBar(); },
  'cm-copy': t => { const m = CHAT.msgs.find(x => x.id === t.dataset.id); closeModal(); if (m && navigator.clipboard) navigator.clipboard.writeText(m.text).then(() => toast('Kopiert'), () => toast('Kopieren nicht möglich')); },
  'cm-del2': t => { closeModal(); chatDelete(t.dataset.id); },
  'cm-report': t => { const m = CHAT.msgs.find(x => x.id === t.dataset.id); if (!m) return; sheet(`<h2>Nachricht melden</h2><div class="cm-msg" style="align-self:stretch;max-width:none"><b class="small" style="color:${nameColor(m.from)}">${nm(m.from)}</b><br>${esc(m.text)}</div>
    <span class="eyebrow">Warum?</span><div class="pick col" role="radiogroup">${['Beleidigung oder Belästigung', 'Spam oder Betrug', 'Unangemessene Inhalte', 'Etwas anderes'].map((r, i) => `<label class="chk"><input type="radio" name="rep-why" value="${esc(r)}" ${i === 0 ? 'checked' : ''}><span>${esc(r)}</span></label>`).join('')}</div>
    <label class="chk"><input type="checkbox" id="rep-block"><span>${nm(m.from)} zusätzlich blockieren</span></label>
    <span class="small muted">Die Nachricht wird zur Prüfung entschlüsselt mitgeschickt und für dich ausgeblendet. ${nm(m.from)} erfährt nicht, wer gemeldet hat.</span>
    <div class="btnrow col"><button class="btn danger" data-act="cm-report-yes" data-id="${esc(m.id)}">Melden</button><button class="btn ghost" data-act="mclose">Abbrechen</button></div>`); },
  'cm-report-yes': async t => { const m = CHAT.msgs.find(x => x.id === t.dataset.id); const why = (document.querySelector('input[name="rep-why"]:checked') || {}).value || '', block = $('#rep-block') && $('#rep-block').checked;
    const h = chatHidden(); if (!h.includes(t.dataset.id)) h.push(t.dataset.id); LS.set('chat.hidden.' + cfg.me, h); closeModal(); chatChanged();
    const r = m ? await sb.from('reports').insert({ target_type: 'message', target_id: m.id, reason: why.slice(0, 500), content: m.text.slice(0, 4000) }) : { error: true };
    toast(r.error ? 'Ausgeblendet. Melden klappt beim nächsten Mal.' : 'Gemeldet und ausgeblendet');
    if (block && m) { await rpcDo('block_user', { other: m.from }); location.hash = '#chats'; } },
  'cm-jump': (t, e) => { e.stopPropagation(); const el = document.getElementById('cm-' + t.dataset.id); if (!el) { toast('Nachricht nicht mehr da'); return; } el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.remove('flash'); el.getBoundingClientRect(); el.classList.add('flash'); },
  start: () => startTraining(false),
  'start-normal': () => startTraining(true),
  'other-day': () => { otherDayAsk = true; render(); },
  'pause-open': () => pauseOpen(),
  'step-adopt': t => { const el = $('#f-step'); if (el) { el.value = fmtIn(+t.dataset.v); el.dispatchEvent(new Event('input', { bubbles: true })); } t.closest('.help').remove(); },
  'kurz-open': () => { const k = (PROFILES[cfg.me] || {}).kurz || '';
    sheet(`<h2>Kürzel im Kalender</h2><p class="muted" style="margin:0">Steht in den Marken im Kalender, damit deine Crew dich erkennt. 1–2 Buchstaben oder Ziffern. Leer lassen: Die App wählt automatisch.</p>
      <input class="inp mono" id="kurz-in" maxlength="2" value="${esc(k)}" placeholder="${esc(kurzMap()[cfg.me] || '')}" autocapitalize="characters" autocomplete="off" spellcheck="false" style="font-size:22px;text-align:center;letter-spacing:.1em">
      <div class="err" id="kurz-err" hidden></div>
      <div class="btnrow col"><button class="btn primary" data-act="kurz-save">Speichern</button><button class="btn ghost" data-act="mclose">Abbrechen</button></div>`); },
  'kurz-save': async () => { const v = ($('#kurz-in').value || '').trim(), e = $('#kurz-err');
    if (v && !/^[A-Za-zÄÖÜäöüß0-9]{1,2}$/.test(v)) { e.textContent = 'Nur Buchstaben oder Ziffern, höchstens 2.'; e.hidden = false; return; }
    const r = await sb.from('profiles').update({ kurz: v || null }).eq('id', cfg.me);
    if (r.error) { e.textContent = 'Speichern hat nicht geklappt.'; e.hidden = false; return; }
    if (PROFILES[cfg.me]) PROFILES[cfg.me].kurz = v || null; LS.set('profiles', PROFILES); closeModal(); toast('Kürzel gespeichert'); render(); },
  'pz-reason': t => { PZS.reason = PZS.reason === t.dataset.v ? '' : t.dataset.v; pauseSheet(); },
  'pz-noreason': () => { PZS.reason = ''; pauseSheet(); },
  'pz-consent': () => healthSheet(() => pauseSheet(), 'pause'),
  'pz-reopen': () => pauseSheet(),
  'pz-quick': t => pzQuick(t.dataset.v),
  'pz-day': t => pzDay(t.dataset.v),
  'pz-month': t => { const [y, m] = PZS.m.split('-').map(Number), d = new Date(y, m - 1 + (+t.dataset.v), 1); PZS.m = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; pauseSheet(); },
  'pz-save': () => pzSave(),
  'pz-end': () => pzEnd(),
  'pz-privacy': () => { PZS.reopen = true; $('#modal').innerHTML = ''; location.hash = '#privatsphaere'; },
  'other-no': () => { otherDayAsk = false; render(); },
  'start-day': t => { otherDayAsk = false; startTraining(false, t.dataset.v); },
  sync: () => sync({ overlay: true }),
  tmr: t => { const i = +t.dataset.i, j = +t.dataset.j; if (TIMER && TIMER.i === i && TIMER.j === j) tmrPause(); else tmrStart(i, j); },
  'tmr-pause': () => tmrPause(),
  'tmr-stop': () => tmrStop(),
  'tmr-x': () => tmrEnd(null),
  'why-rm': t => { const it = draft.items[+t.dataset.i], k = it.rm.length - 1; if (k < 0) return; it.rm[k] = it.rm[k] === t.dataset.v ? '' : t.dataset.v; saveDraft(); rerenderCard(+t.dataset.i); },
  'why-add': t => { const it = draft.items[+t.dataset.i], l = [...it.sets].reverse().find(x => x.add); if (!l) return; l.a = l.a === t.dataset.v ? '' : t.dataset.v; saveDraft(); rerenderCard(+t.dataset.i); },
  check: t => {
    const i = +t.dataset.i, j = +t.dataset.j, x = draft.items[i].ex;
    if (TIMER && TIMER.i === i && TIMER.j === j) tmrStop();
    const s = readSetInputs(i, j);
    if (!s.done && x.type === 'tr') {
      if (!int(s.w)) s.w = String(draft.items[i].tt || x.min);
      if (!int(s.r)) { toast('Trag zuerst die Wiederholungen ein.'); const r = document.getElementById(`r-${i}-${j}`); if (r) r.focus(); return; }
    }
    if (!s.done && x.type === 'kg' && !num(s.w)) { toast('Trag zuerst das Gewicht ein.'); const w = document.getElementById(`w-${i}-${j}`); if (w) w.focus(); return; }
    if (!s.done && !int(s.r)) { const mine = lastAny(cfg.me, x.id); s.r = String(draft.deload ? x.min : s.t || (mine && mine.type === x.type && mine.sets[j] ? mine.sets[j].r : x.max)); }
    s.done = !s.done; saveDraft(); rerenderCard(i);
  },
  sign: t => {
    const i = +t.dataset.i, j = +t.dataset.j, it = draft.items[i];
    it.sets.forEach((x, k) => readSetInputs(i, k));
    const s = it.sets[j]; if (s.done) return;
    [s.w, s.alt] = [s.alt, s.w]; s.neg = !s.neg; s.man = true; s.mk = ''; s.lab = '';
    propagateDown(i, j);
    saveDraft(); rerenderCard(i);
  },
  sfeel: t => { const i = +t.dataset.i, s = draft.items[i].sets[+t.dataset.j]; s.f = s.f === t.dataset.v ? '' : t.dataset.v; saveDraft(); rerenderCard(i); },
  wu: t => { const it = draft.items[+t.dataset.i]; it.wu[0] = !it.wu[0]; saveDraft(); rerenderCard(+t.dataset.i); },
  'plateau-down': t => {
    const i = +t.dataset.i, it = draft.items[i], x = it.ex, step = stepOf(x);
    it.sets.forEach((s, j) => readSetInputs(i, j));
    it.sets.forEach(s => {
      if (s.done) return;
      const cur = Math.abs(num(s.w)) * (s.neg ? -1 : 1);
      if (x.type === 'kg') { if (!cur) return; const w = roundTo(cur * 0.9, step); s.w = fmtIn(w); s.mk = 'down'; s.lab = '↓ −10 %'; }
      else if (x.type === 'bw') { const w = roundTo(cur - step, step), d = w - cur; if (w < 0 !== s.neg) { s.alt = s.w; s.neg = w < 0; } s.w = w ? fmtIn(w) : ''; s.mk = 'down'; s.lab = '↓ ' + kgLabel(d); }
    });
    it.kind = 'hold'; it.hint = x.type === 'kg' ? 'Seit 3 Trainings kein Fortschritt. Heute −10 %.' : `Seit 3 Trainings kein Fortschritt. Heute ${fmtN(step)} kg leichter.`;
    saveDraft(); rerenderCard(i); toast(x.type === 'kg' ? 'Gewicht für heute um 10 % reduziert' : 'Gewicht für heute reduziert');
  },
  // + Satz holt zuerst einen gestrichenen Satz zurück, sonst ist es ein zusätzlicher Satz (Grund optional)
  addset: t => {
    const i = +t.dataset.i, it = draft.items[i]; it.sets.forEach((s, j) => readSetInputs(i, j)); const l = it.sets[it.sets.length - 1];
    const back = it.rm.length > 0; if (back) it.rm.pop();
    it.sets.push(blankSet(null, { w: l ? (it.ex.type === 'tr' ? String(it.tt || l.w) : l.w) : '', neg: l ? l.neg : false, alt: l ? l.alt : '', mk: l && !l.add ? l.mk : '', lab: l && !l.add ? l.lab : '', add: !back }));
    saveDraft(); rerenderCard(i);
  },
  // − Satz: ein zusätzlicher Satz verschwindet einfach, ein geplanter wird gestrichen (Grund optional)
  delset: t => {
    const i = +t.dataset.i, it = draft.items[i]; if (it.sets.length <= 1) return; it.sets.forEach((s, j) => readSetInputs(i, j));
    if (TIMER && TIMER.i === i && TIMER.j === it.sets.length - 1) tmrEnd(null);
    const l = it.sets.pop(); if (!l.add) it.rm.push('');
    saveDraft(); rerenderCard(i);
  },
  'swap-open': t => (draft && draft.edit ? edPickForm(+t.dataset.i) : swapForm(+t.dataset.i)),
  'mus-full': t => { const x = exById(t.dataset.ex); if (x) openMusFull(x, t.dataset.tone); },
  'mf-side': t => { const f = $('#mf-flip'); if (!f) return; f.classList.toggle('turned', t.dataset.v === 'b'); document.querySelectorAll('[data-act="mf-side"]').forEach(b => b.setAttribute('aria-pressed', String(b === t))); },
  'mus-edit': () => openMusEditor(),
  'me-side': t => { musEd.view = t.dataset.v; musEdRender(); },
  'me-cancel': () => { const o = $('#museditor'); if (o) o.remove(); musEd = null; },
  'me-done': () => { $('#f-muscles').value = JSON.stringify(musEd.m); $('#f-mus-prev').innerHTML = musPreview(musEd.m, musEd.tk); const o = $('#museditor'); if (o) o.remove(); musEd = null; },
  'swap-follow': t => {
    const sw = st().swaps.find(e => e.id === t.dataset.id), i = +t.dataset.i; if (!sw) return;
    doSwap(i, clone(sw.data.to), { id: sw.data.fromId, name: sw.data.fromName }, sw.person, false); render(); toast('Getauscht');
  },
  'swap-ignore': t => { draft.swapIgnored.push(t.dataset.id); saveDraft(); render(); },
  'finish-ask': () => finishSheet(),
  'finish-yes': () => finishTraining(),
  'discard-ask': () => discardSheet(),
  'discard-yes': () => { TIMER = null; clearTimeout(tmrTO); draft = null; saveDraft(); $('#modal').innerHTML = ''; toast('Training verworfen'); location.hash = '#start'; },
  'bw-save': () => {
    if (!hasConsent('health')) { healthSheet(() => actions['bw-save']()); return; }
    const el = $('#bw-in'), v = num(el && el.value), fe = $('#bw-from');
    let from = fe && /^\d{4}-\d{2}-\d{2}$/.test(fe.value) ? fe.value : todayStr();
    if (from > todayStr()) from = todayStr();
    if (v < 30 || v > 300) { toast('Bitte ein Gewicht zwischen 30 und 300 kg eingeben.'); return; }
    const kg = Math.round(v * 10) / 10;
    addEvent('bodyweight', { kg, from }, `Körpergewicht ${fmtN(kg)} kg ab ${new Date(from + 'T12:00').toLocaleDateString('de-DE')}`);
    toast(from === todayStr() ? 'Körpergewicht gespeichert' : 'Körpergewicht für diesen Zeitraum gespeichert'); render();
  },
  vtab: t => { verlaufTab = t.dataset.v; render(); },
  exmode: t => { exMode = t.dataset.v; render(); },
  exper: t => { exPeriod = t.dataset.v; render(); },
  calmove: t => { cal.m += +t.dataset.v; if (cal.m < 0) { cal.m = 11; cal.y--; } if (cal.m > 11) { cal.m = 0; cal.y++; } render(); },
  calday: t => { cal.sel = t.dataset.v; render(); },
  nfilter: t => { notesFilter = t.dataset.v; render(); },
  accept: t => acceptChange(t.dataset.id, false),
  'accept-draft': t => acceptChange(t.dataset.id, true),
  dismiss: t => dismissChange(t.dataset.id),
  'notice-ok': t => { const id = t.dataset.id; if (id === 'regen') LS.set('regen.ack', Date.now()); else { const a = LS.get('notice.ack', {}); a[id] = 1; LS.set('notice.ack', a); } render(); },
  bday: t => { builder.day = t.dataset.v; render(); },
  bmove: t => { const a = builder.work[builder.day].exercises, i = +t.dataset.i, j = i + +t.dataset.v; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; markDirty(); render(); },
  bedit: t => exerciseForm('edit', +t.dataset.i),
  breplace: t => exerciseForm('replace', +t.dataset.i),
  badd: () => exerciseForm('add'),
  bremove: t => { const a = builder.work[builder.day].exercises; const x = a.splice(+t.dataset.i, 1)[0]; markDirty(); render(); toast(`${x.name} entfernt. Speichern nicht vergessen.`); },
  bdiscard: () => { const saved = planOf(cfg.me, builder.kind)[builder.day]; if (saved) builder.work[builder.day] = clone(saved); else { delete builder.work[builder.day]; builder.day = PD(builder.work)[0]; } builder.dirty[builder.day] = false; render(); },
  pkind: t => { if (builderDirty() && builder.kind !== t.dataset.v) { toast('Speichere oder verwirf zuerst deine Änderungen.'); return; } planKind = t.dataset.v; render(); },
  'bday-add': () => addPlanDay(),
  'bday-edit': () => dayEditSheet(false),
  'bday-del': () => dayEditSheet(false, true),
  'bday-del-no': () => dayEditSheet(false),
  'bday-del-yes': () => deletePlanDay(),
  'bday-cancel': () => { const d = builder.day; if (!planOf(cfg.me, builder.kind)[d]) { delete builder.work[d]; delete builder.dirty[d]; builder.day = PD(builder.work)[0]; } closeModal(); render(); },
  nscope: t => { const it = draft && draft.items[+t.dataset.i]; if (!it) return; it.nscope = t.dataset.v; saveDraft(); render(); setTimeout(() => { const ta = document.getElementById('note-' + t.dataset.i); if (ta) ta.focus(); }, 30); },
  skind: t => { startKind = t.dataset.v; otherDayAsk = false; render(); },
  'bud-send': async t => { const id = t.dataset.id; if (budState(id) === 'incoming') { await rpcDo('respond_friend_request', { other: id, accept: true }, 'Ihr seid jetzt Gym Buddys'); return; } const r = await rpcDo('send_friend_request', { target: id }); if (r) toast(r === 'accepted' ? 'Ihr seid jetzt Gym Buddys' : 'Anfrage gesendet'); },
  'bud-accept': t => rpcDo('respond_friend_request', { other: t.dataset.id, accept: true }, 'Ihr seid jetzt Gym Buddys'),
  'bud-decline': t => rpcDo('respond_friend_request', { other: t.dataset.id, accept: false }, 'Anfrage abgelehnt'),
  'bud-cancel': async t => { const me = cfg.me, o = t.dataset.id; const r = await sb.from('friendships').delete().eq('a', me < o ? me : o).eq('b', me < o ? o : me); toast(r.error ? 'Das hat nicht geklappt.' : 'Anfrage zurückgezogen'); await sync({ quiet: true }); render(); },
  'bud-menu': t => buddyMenu(t.dataset.p || t.dataset.id),
  'bud-remove': t => buddyMenu(t.dataset.id, 'remove'),
  'bud-block': t => buddyMenu(t.dataset.id, 'block'),
  'bud-report': t => buddyMenu(t.dataset.id, 'report'),
  'bud-remove-yes': async t => { const me = cfg.me, o = t.dataset.id; closeModal(); const r = await sb.from('friendships').delete().eq('a', me < o ? me : o).eq('b', me < o ? o : me); toast(r.error ? 'Das hat nicht geklappt.' : 'Als Buddy entfernt'); await sync({ quiet: true }); location.hash = '#buddies'; },
  'bud-block-yes': async t => { closeModal(); const ok = await rpcDo('block_user', { other: t.dataset.id }, 'Blockiert'); if (ok) location.hash = '#buddies'; },
  'bud-report-yes': async t => { const why = (document.querySelector('input[name="rep-why"]:checked') || {}).value || '', block = $('#rep-block') && $('#rep-block').checked, id = t.dataset.id; closeModal();
    const r = await sb.from('reports').insert({ target_type: 'profile', target_id: id, reason: why.slice(0, 500) }); toast(r.error ? 'Melden hat nicht geklappt. Bitte später noch einmal.' : 'Danke, wir sehen es uns an.');
    if (block) { await rpcDo('block_user', { other: id }); location.hash = '#buddies'; } },
  'crew-create': async () => { const n = ($('#crew-name').value || '').trim(); CREWV.name = n; const e = $('#crew-err'); if (n.length < 2) { e.textContent = 'Bitte gib einen Namen mit mindestens 2 Zeichen ein.'; e.hidden = false; return; } const r = await rpcDo('create_crew', { crew_name: n }, `Crew ${n} gegründet`); if (r) { planKind = null; builder = null; render(); } },
  'crew-edit': () => { CREWV.edit = true; render(); setTimeout(() => { const i = $('#crew-rename'); if (i) i.focus(); }, 30); },
  'crew-rename': async () => { const n = ($('#crew-rename').value || '').trim(); CREWV.edit = false; if (!n || n === CREW.name) { render(); return; } const r = await sb.from('crews').update({ name: n }).eq('id', CREW.id); if (r.error) toast(/valid_name|check/.test(r.error.message || '') ? 'Bitte wähle einen anderen Namen.' : 'Umbenennen hat nicht geklappt.'); else toast('Crew umbenannt'); await sync({ quiet: true }); render(); },
  'crew-invite': () => { if (view !== 'crew') { location.hash = '#crew'; setTimeout(() => { CREWV.invite = true; render(); }, 50); return; } CREWV.invite = true; render(); },
  'crew-invite-no': () => { CREWV.invite = false; render(); },
  'crew-invite-yes': t => rpcDo('invite_to_crew', { friend: t.dataset.id }, `${pname(t.dataset.id)} eingeladen`),
  'crew-join': async t => { const r = await rpcDo('join_crew', { crew: t.dataset.id }, 'Willkommen in der Crew'); if (r) { planKind = null; builder = null; adoptCrewPlan(); } },
  'crew-inv-no': async t => { const r = await sb.from('crew_invites').delete().eq('crew_id', t.dataset.id).eq('user_id', cfg.me); toast(r.error ? 'Das hat nicht geklappt.' : 'Einladung abgelehnt'); await sync({ quiet: true }); render(); },
  'crew-rm': t => { CREWV.rm = t.dataset.id; render(); },
  'crew-rm-no': () => { CREWV.rm = null; render(); },
  'crew-rm-yes': t => { CREWV.rm = null; rpcDo('remove_from_crew', { other: t.dataset.id }, `${pname(t.dataset.id)} entfernt`); },
  'crew-leave': () => { CREWV.leave = true; render(); },
  'crew-leave-no': () => { CREWV.leave = false; render(); },
  'crew-leave-yes': async () => { CREWV.leave = false; const r = await rpcDo('leave_crew', {}, 'Du hast die Crew verlassen'); if (r) { planKind = null; startKind = null; builder = null; location.hash = '#buddies'; } },
  'goto-crewplan': () => { planKind = 'crew'; builder = null; },
  'id-sheet': () => idSheet(),
  'scan-type': () => { setTimeout(() => { const i = $('#bud-q'); if (i) i.focus(); }, 80); },
  'goal-open': () => goalSheet(),
  'goal-pick': t => { document.querySelectorAll('.wzb').forEach(b => { const on = b === t; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); const s = $('[data-act="goal-save"]'); if (s) s.dataset.v = t.dataset.v; },
  'goal-save': async t => { const n = int(t.dataset.v); closeModal(); const r = await sb.rpc('set_week_goal', { n }); if (r.error) { toast('Speichern hat nicht geklappt.'); return; } toast(r.data ? `Neues Wochenziel ${n} gilt ab Montag` : `Wochenziel: ${n}`); await sync({ quiet: true }); render(); },
  'health-yes': async () => { const ok = await setConsent('health', true); closeModal(); if (ok) { toast('Danke. Gesundheitsdaten werden gespeichert.'); const n = HEALTH_NEXT; HEALTH_NEXT = null; if (n) n(); else render(); } },
  'health-ask': () => healthSheet(() => render()),
  'health-withdraw': () => healthWithdrawSheet(),
  'health-keep': async () => { closeModal(); if (await setConsent('health', false)) { toast('Widerrufen. Neue Einträge werden nicht mehr gespeichert.'); render(); } },
  'health-del': () => healthDeleteAll(),
  'stats-yes': async () => { closeModal(); if (await setConsent('analytics', true)) toast('Danke fürs Mithelfen'); },
  'stats-no': async () => { closeModal(); await setConsent('analytics', false); },
  'data-export': () => exportData(),
  'data-share': () => shareData(),
  'del-ask': () => deleteSheet(),
  'del-yes': async () => { closeModal(); const r = await sb.rpc('request_account_deletion'); if (r.error) { toast('Das hat nicht geklappt. Bitte später noch einmal.'); return; } if (isOwner()) await sb.rpc('leave_crew'); toast('Löschung beantragt. Du wirst abgemeldet.'); setTimeout(() => actions['logout-yes'](), 800); },
  'del-cancel': async () => { const r = await sb.rpc('cancel_account_deletion'); if (r.error) { toast('Das hat nicht geklappt.'); return; } toast('Löschung zurückgenommen. Schön, dass du bleibst.'); await sync({ quiet: true }); render(); },
  'fb-kind': t => { FB.kind = t.dataset.v; const txt = ($('#fb-text') || {}).value || ''; render(); const ta = $('#fb-text'); if (ta) ta.value = txt; },
  'fb-send': async () => { const text = ($('#fb-text').value || '').trim(); if (text.length < 3) { toast('Schreib uns kurz, worum es geht.'); return; } FB.meta = $('#fb-meta').checked;
    const r = await sb.from('feedback').insert({ kind: FB.kind, text: text.slice(0, 4000), app_version: FB.meta ? APP_VERSION : null, platform: FB.meta ? (/iPhone|iPad/.test(navigator.userAgent) ? 'iOS' : 'Web') : null });
    if (r.error) { toast('Senden hat nicht geklappt. Bitte später noch einmal.'); return; } toast('Danke für dein Feedback!'); location.hash = '#einstellungen'; },
  'note-more': t => { const k = t.dataset.v; if (NOTE_OPEN.has(k)) NOTE_OPEN.delete(k); else NOTE_OPEN.add(k); safeRender(); },
  'note-edit': t => openNoteMenu(t.dataset.id, 'edit'),
  'note-del': t => openNoteMenu(t.dataset.id, 'del'),
  'note-del-yes': t => { deleteNote(t.dataset.id); closeModal(); toast('Notiz gelöscht'); safeRender(); notesSync(); },
  'note-copy': t => { const n = liveNotes().find(x => x.id === t.dataset.id); try { navigator.clipboard.writeText(n.body); toast('Kopiert'); } catch (e) {} closeModal(); },
  'note-report': t => reportNote(t.dataset.id),
  nfilt: t => { notesFilter3[t.dataset.k] = t.dataset.v; noteFocusEnd(); render(); },
  bsave: () => savePlan(),
  'w-edit': t => { const w = st().workouts.find(x => x.id === t.dataset.id); if (!w || (w.person !== cfg.me && !LS.get('dev', false))) return; openEdit(w); },
  'ed-addex': () => edPickForm('add'),
  'ed-rmex': t => { const i = +t.dataset.i; draft.items[i].ask = true; rerenderCard(i); },
  'ed-rmex-no': t => { const i = +t.dataset.i; draft.items[i].ask = false; rerenderCard(i); },
  'ed-rmex-yes': t => { draft.items.splice(+t.dataset.i, 1); saveDraft(); render(); },
  'ed-save': () => saveEdit(),
  'ed-cancel': () => { const ref = draft && draft.ref; draft = null; LS.set('edraft', null); location.hash = ref ? '#training-log:' + encodeURIComponent(ref) : '#verlauf'; },
  'lib-g': t => { LIBV.group = t.dataset.v; const l = $('#lib-list'); if (l) l.innerHTML = libListHTML(); },
  'lib-open': t => libForm(libGet(t.dataset.id), { tk: 'y' }),
  'lib-new': () => libForm(null, { name: LIBV.q, tk: 'y' }),
  'lib-tpl': t => { const o = LF && LF.opts; libForm(null, { ...(o || {}), tpl: t.dataset.id }); },
  'lib-suggest': t => libSuggest(t.dataset.id),
  'lib-edit': t => { pkKeep(); const snap = PK, back = () => { PK = snap; snap.reopen(); }; libForm(libGet(t.dataset.id), { tk: DAY_TONE[snap.day], done: back, cancel: back }); },
  'lib-merge': () => { if (LF && LF.id) libMergeForm(LF.id); },
  'lib-unmerge': t => { const y = st().lib[t.dataset.id]; if (!y || y.owner !== cfg.me) return; const cur = LF && LF.id, o = LF && LF.opts; libSaveOwn({ ...y, into: '' }); toast(`${y.name} ist wieder eigenständig`); if (cur) libForm(st().lib[cur], o); },
  'lib-hide': () => libAct('hide'),
  'lib-show': () => libAct('show'),
  'lib-del': () => libAct('del'),
  'lf-use': t => { const o = LF && LF.opts; if (o && o.done && PK) { LF = null; o.done(t.dataset.id); } else libForm(libGet(t.dataset.id)); },
  'pk-g': t => { PK.group = t.dataset.v; renderPick(); },
  'pk-pick': t => { PK.sel = t.dataset.id; renderPick(); if (PK.onSel) PK.onSel(libGet(PK.sel)); },
  'pk-clear': () => { PK.sel = ''; renderPick(); if (PK.onSel && PK.ctx === 'merge') PK.onSel(); const q = $('#pk-q'); if (q) q.focus(); },
  'pk-new': () => { pkKeep(); const snap = PK; libForm(null, { name: PK.q, tk: DAY_TONE[PK.day], done: id => { PK = snap; PK.sel = id; PK.q = ''; snap.reopen(); if (PK && PK.ctx === 'swap' && PK.onSel) PK.onSel(libGet(id)); }, cancel: () => { PK = snap; snap.reopen(); } }); },
  'me-pick': t => { const k = t.dataset.m; if (LABEL_VIEW[k]) musEd.view = LABEL_VIEW[k]; else if (FRONT_IDS.has(k) && !BACK_IDS.has(k)) musEd.view = 'front'; else if (BACK_IDS.has(k) && !FRONT_IDS.has(k)) musEd.view = 'back'; const m2 = musEd.m; if (m2.p.includes(k)) { m2.p = m2.p.filter(y => y !== k); m2.s.push(k); } else if (m2.s.includes(k)) m2.s = m2.s.filter(y => y !== k); else m2.p.push(k); musEdRender(k); },
  'w-del': t => { wDelAsk = t.dataset.id; render(); },
  'w-del-no': () => { wDelAsk = null; render(); },
  'w-del-yes': t => {
    const w = st().workouts.find(x => x.id === t.dataset.id); if (!w || w.person !== cfg.me) return;
    addEvent('workout_edit', { ref: w.id, deleted: true }, `${dl(w.data.day)} vom ${fmtDate(w.ts)} gelöscht`);
    wDelAsk = null; toast('Training gelöscht'); location.hash = '#verlauf';
  },
  goprof: (t, e) => { e.preventDefault(); e.stopPropagation(); location.hash = '#profil' + (t.dataset.p === cfg.me ? '' : ':' + t.dataset.p); },
  'spot-open': () => openViewer(),
  'sp-shoot': () => shoot(),
  'sp-flip': () => { SPOT.facing = SPOT.facing === 'user' ? 'environment' : 'user'; startCamera(); },
  'sp-cancel': () => { closeEditor(); location.hash = '#kamera'; },
  'sp-text': () => { if (SPOT.ed.editing) endText(); else editText(); },
  'sp-dark': () => { endText(); SPOT.ed.dark = !SPOT.ed.dark; render(); },
  'sp-bar': () => { endText(); SPOT.ed.bar = !SPOT.ed.bar; render(); },
  'sp-send': () => sendSpot(),
  'sv-close': () => closeViewer(),
  'sv-prof': (t, e) => { e.preventDefault(); const p = SPOT.view && SPOT.view.list[SPOT.view.i].person; closeViewer(); if (p) location.hash = '#profil:' + p; },
  'sv-react': t => { const v = SPOT.view; if (!v) return; spotReact(v.list[v.i], t.dataset.v); },
  'sv-compose': t => svCompose(t.dataset.v),
  'sv-c-x': () => svComposeEnd(),
  'sg-save': t => {
    const id = t.dataset.id, rs = spotReactions(id);
    if (!rs.length) { saveSpotToPhotos(id, false); return; }
    const who = [...new Set(rs.map(r => r.p))];
    sheet(`<h2>In Fotos sichern</h2><p class="muted" style="margin:0">${esc(who.join(' und '))} ${who.length === 1 ? 'hat' : 'haben'} auf diesen Spot reagiert. Sollen die Reaktionen mit aufs Bild?</p>
      <div class="btnrow col"><button class="btn primary" data-act="sg-save-go" data-id="${esc(id)}" data-v="plain">Nur das Foto</button><button class="btn" data-act="sg-save-go" data-id="${esc(id)}" data-v="react">Mit Reaktionen</button></div>
      <span class="small muted" style="text-align:center">Ohne Reaktionen fragt die App nicht nach und sichert direkt.</span>`);
  },
  'sg-save-go': t => { $('#modal').innerHTML = ''; saveSpotToPhotos(t.dataset.id, t.dataset.v === 'react'); },
  'chat-new': () => chatNewSheet(),
  'spot-replay': t => openSpotReplay(t.dataset.id),
  'cm-del': t => {
    const m = CHAT.msgs.find(x => x.id === t.dataset.id); if (!m) return;
    sheet(`<h2>Nachricht löschen?</h2><div class="cdel-prev">${esc(m.text)}</div><p class="muted" style="margin:0">Sie verschwindet bei dir und bei ${nm(m.to)}.</p>
      <div class="btnrow col"><button class="btn danger" data-act="cm-del-yes" data-id="${esc(m.id)}">Für beide löschen</button><button class="btn ghost" data-act="mclose">Abbrechen</button></div>`);
  },
  'cm-del-yes': t => { $('#modal').innerHTML = ''; chatDelete(t.dataset.id); },
  'sw-carry': () => swapDo('carry'),
  'sw-both': () => swapDo('both'),
  'sw-back': () => { const q = SWAPQ; SWAPQ = null; if (q && PK) swapForm(q.i, true); else $('#modal').innerHTML = ''; },
  'chat-open': t => { $('#modal').innerHTML = ''; location.hash = '#chat:' + encodeURIComponent(t.dataset.p); },
  'sg-del': t => { SPOT.galDel = t.dataset.id; render(); },
  'sg-del-no': () => { SPOT.galDel = null; render(); },
  'sg-del-yes': t => deleteSpot(t.dataset.id),
  'cam-del': t => {
    const g = SPOT.gallery.find(x => x.id === t.dataset.id); if (!g) return;
    const seen = others().some(o => spotSeenBy(g.id, o));
    sheet(`<div class="spdel"><img src="${spotUrl(g)}" alt="Spot vom ${fmtDate(g.created)}"><h2>Spot löschen?</h2>
      <span class="mono muted small">${relDay(g.created)} · ${fmtTime(g.created)}${seen ? ' · gesehen' : g.shared ? ' · noch nicht gesehen' : ' · noch nicht gesendet'}</span>
      <p class="muted" style="margin:0">Der Spot verschwindet aus deiner Galerie.${!seen ? ' Wer ihn noch nicht gesehen hat, bekommt ihn nicht mehr zu sehen.' : ''}</p></div>
      <div class="btnrow col"><button class="btn danger" data-act="cam-del-yes" data-id="${esc(g.id)}">Löschen</button><button class="btn ghost" data-act="mclose">Abbrechen</button></div>`);
  },
  'cam-del-yes': async t => { $('#modal').innerHTML = ''; await deleteSpot(t.dataset.id, '#kamera'); },
  mclose: () => closeModal(),
  'mclose-bg': (t, e) => { if (e.target === t) closeModal(); },
  pin: t => { if (VAULT.pin.length >= 4) return; VAULT.pin += t.dataset.v; VAULT.msg = ''; if (VAULT.pin.length === 4) { render(); pinComplete(); } else render(); },
  'pin-del': () => { VAULT.pin = VAULT.pin.slice(0, -1); render(); },
  'v-lock': () => { lockVault(); location.hash = '#profil'; },
  'v-del': t => { VAULT.del = t.dataset.id; render(); },
  'v-del-no': () => { VAULT.del = null; render(); },
  'rk-copy': async () => { try { await navigator.clipboard.writeText(VAULT.showKey); toast('Schlüssel kopiert'); } catch (e) { const r = document.createRange(); r.selectNodeContents($('#rk-show')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('Markiert. Jetzt über „Kopieren“ kopieren.'); } },
  'rk-done': () => { const m = vmeta(); if (m) { m.saved = true; LS.set('vault.' + cfg.me, m); } VAULT.showKey = null; loadVault().then(render); },
  'rk-restore': () => startRestore(),
  'v-showkey': () => { lockVault(); VAULT.wantKey = true; location.hash = '#vault'; render(); },
  'v-del-yes': async t => { await deleteVaultEntry(t.dataset.id); if (VAULT.urls[t.dataset.id]) { URL.revokeObjectURL(VAULT.urls[t.dataset.id]); delete VAULT.urls[t.dataset.id]; } VAULT.del = null; await loadVault(); toast('Bild gelöscht'); render(); },
  'v-change': () => { lockVault(); VAULT.mode = 'old'; location.hash = '#vault'; render(); },
  'v-export': () => exportVault(),
  'acct-copy': () => { try { navigator.clipboard.writeText('#' + PROFILES[cfg.me].buddy_id); toast('Buddy-ID kopiert'); } catch (e) {} },
  'logout-ask': () => { logoutAsk = true; render(); },
  'logout-no': () => { logoutAsk = false; render(); },
  'logout-yes': async () => {
    try { await sb.auth.signOut(); } catch (e) { /* offline: lokal trotzdem abmelden */ }
    const me = cfg.me; lockVault();
    ['chat.msgs.', 'chat.read.', 'chat.key.', 'chat.tomb.'].forEach(k => localStorage.removeItem('hb.' + k + me));
    events = []; pending = []; lastSeq = 0; lastSync = null; seenIds = new Set(); saveLog(); LS.set('lastSync', null);
    cfg = { me: '', url: '', key: '' }; LS.set('cfg', cfg); LS.set('acct.email', ''); PROFILES = {}; CREW = null; LS.set('profiles', {}); LS.set('crew', null); computePeople(); LS.set('people.full', []); LS.set('social', null); CONSENTS = {}; LS.set('consents', {}); LS.set('stats.asked', false); SOCIAL = { incoming: [], outgoing: [], invites: [], crewInvites: [], crewMeta: null }; NOTES = []; saveNotes(); LIBQ = []; LS.set('lib.q', []);
    CHAT.msgs = []; CHAT.hold = []; CHAT.loaded = false; CK.state = 'none'; CK.for = null; logoutAsk = false; builder = null; draft = null; saveDraft(); invalidate();
    location.hash = ''; render();
  },
  'reset-ask': () => { resetAsk = true; render(); },
  'reset-no': () => { resetAsk = false; render(); },
  'reset-yes': () => { events = []; pending = []; lastSeq = 0; lastSync = null; seenIds = new Set(); saveLog(); LS.set('lastSync', null); resetAsk = false; invalidate(); builder = null; sync({ overlay: true }); render(); },
  'onb-go': t => onbGo(t.dataset.v),
  'onb-back': t => onbGo(t.dataset.v),
  'onb-send': async () => {
    const em = ONB.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { ONB.err = 'Bitte gib eine gültige E-Mail-Adresse ein.'; return render(); }
    ONB.busy = true; ONB.err = ''; render();
    const r = await sb.auth.signInWithOtp({ email: em, options: { shouldCreateUser: true } });
    ONB.busy = false;
    if (r.error) { ONB.err = sbMsg(r.error); return render(); }
    ONB.email = em; ONB.code = ''; if (ONB.step === 'code') { toast('Neuer Code ist unterwegs'); render(); } else onbGo('code');
  },
  'onb-verify': async () => {
    if (ONB.code.length !== 6) return;
    ONB.busy = true; ONB.err = ''; render();
    const r = await sb.auth.verifyOtp({ email: ONB.email, token: ONB.code, type: 'email' });
    if (r.error) { ONB.busy = false; ONB.err = sbMsg(r.error); ONB.code = ''; return render(); }
    try { await onbAfterLogin(); } catch (e) { ONB.busy = false; ONB.err = sbMsg(e); render(); }
  },
  'onb-claim': async () => {
    const code = ($('#onb-in') || {}).value || '';
    if (code.replace(/[^A-Za-z0-9]/g, '').length < 8) { ONB.err = 'Der Code hat mindestens 8 Zeichen.'; return render(); }
    ONB.busy = true; ONB.err = ''; render();
    const r = await sb.rpc('claim_by_code', { code });
    if (r.error) { ONB.busy = false; ONB.err = sbMsg(r.error); return render(); }
    ONB.claim = r.data; ONB.name = (r.data && r.data.name) || ONB.name; onbGo('claimok');
  },
  'onb-name': async () => {
    if (!nameOk(ONB.name)) return;
    ONB.busy = true; ONB.err = ''; render();
    const { data: u } = await sb.auth.getUser();
    const r = await sb.from('profiles').update({ name: ONB.name }).eq('id', u.user.id);
    if (r.error) { ONB.busy = false; ONB.err = sbMsg(r.error); return render(); }
    onbGo('goal');
  },
  'onb-goal': t => { ONB.goal = +t.dataset.v; onbSave(); render(); },
  'onb-goalok': async () => {
    ONB.busy = true; render();
    const r = await sb.rpc('set_week_goal', { n: ONB.goal });
    if (r.error) { ONB.busy = false; ONB.err = sbMsg(r.error); return render(); }
    onbGo('privacy');
  },
  'onb-privacy': async () => {
    if (!ONB.ok) return;
    ONB.busy = true; render();
    const r = await sb.from('consents').insert({ kind: 'privacy', version: '1', granted: true });
    if (r.error) { ONB.busy = false; ONB.err = sbMsg(r.error); return render(); }
    const { data: u } = await sb.auth.getUser();
    ONB.buddy = ((await sb.from('profiles').select('buddy_id').eq('id', u.user.id).maybeSingle()).data || {}).buddy_id || '';
    onbGo('buddy');
  },
  'onb-copy': () => { try { navigator.clipboard.writeText('#' + ONB.buddy); toast('Buddy-ID kopiert'); } catch (e) {} },
  'onb-done': async t => { const { data: u } = await sb.auth.getUser(); onbFinish(u.user.id, t.dataset.v); },
};
document.addEventListener('click', e => {
  if (e.target.id === 'vn-file') VAULT.picking = Date.now(); // Kamera/Fotoauswahl: Vault währenddessen nicht sperren
  const t = e.target.closest('[data-act]');
  if (!t || !actions[t.dataset.act]) return;
  if (t.tagName === 'BUTTON' && t.type !== 'submit') e.preventDefault();
  if (view === 'bearbeiten' && edraft) withEd(() => actions[t.dataset.act](t, e));
  else actions[t.dataset.act](t, e);
});
document.addEventListener('keydown', e => {
  if (e.target.id === 'sv-in' && e.key === 'Enter' && !e.shiftKey && SPOT.view && SPOT.view.compose === 'emoji') { e.preventDefault(); svSubmit(); }
});
document.addEventListener('submit', e => {
  if (e.target.id === 'exform') { e.preventDefault(); submitExercise(e.target); }
  if (e.target.id === 'dayform') { e.preventDefault(); submitDayForm(); }
  if (e.target.id === 'noteedit') { e.preventDefault(); editNote(e.target.dataset.id, $('#ne-body').value); closeModal(); toast('Notiz gespeichert'); safeRender(); notesSync(); }
  if (e.target.id === 'swapform') { e.preventDefault(); submitSwap(e.target); }
  if (e.target.id === 'edpick') { e.preventDefault(); withEd(() => submitEdPick(e.target)); }
  if (e.target.id === 'libform') { e.preventDefault(); submitLib(e.target); }
  if (e.target.id === 'mergeform') { e.preventDefault(); submitMerge(); }
  if (e.target.id === 'vaultform') { e.preventDefault(); saveVaultEntry(e.target); }
  if (e.target.id === 'sv-compose') { e.preventDefault(); svSubmit(); }
  if (e.target.id === 'chatform') { e.preventDefault(); chatSubmit(); }
  if (e.target.id === 'svsave-form') { e.preventDefault(); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if ((t.id === 'av-file' || t.id === 'av-file2') && t.files[0]) setAvatar(t.files[0]);
  if (t.id === 'v-import' && t.files[0]) readBackupFile(t.files[0]);
  if (t.id === 'stats-tgl') { setConsent('analytics', t.checked).then(ok => { if (!ok) t.checked = !t.checked; else toast(t.checked ? 'Danke fürs Mithelfen' : 'Statistik ausgeschaltet'); }); }
  if (t.id === 'fb-meta') FB.meta = t.checked;
  if (t.id === 'pz-share' || t.id === 'share-p') setSharePause(t.checked, t);
  if (t.id === 'share-w') { const v = t.checked; sb.from('profiles').update({ share_weight: v }).eq('id', cfg.me).then(r => { if (r.error) { toast('Speichern hat nicht geklappt.'); t.checked = !v; return; } if (PROFILES[cfg.me]) PROFILES[cfg.me].share_weight = v; LS.set('profiles', PROFILES); toast(v ? 'Deine Buddys sehen dein Körpergewicht' : 'Körpergewicht nur noch für dich'); }); }
  if ((t.id === 'sp-file' || t.id === 'sp-file2') && t.files[0]) openEditor(t.files[0]);
  if (t.dataset.f === 'w') { const go = () => { if (draft && draft.items[+t.dataset.i] && draft.items[+t.dataset.i].ex.type === 'bw' && propagateDown(+t.dataset.i, +t.dataset.j)) { saveDraft(); rerenderCard(+t.dataset.i); } }; if (view === 'bearbeiten' && edraft) withEd(go); else go(); }
  if (t.id === 'vn-file' && t.files[0]) {
    if (VAULT.photoUrl) URL.revokeObjectURL(VAULT.photoUrl);
    VAULT.picking = 0; VAULT.photo = t.files[0]; VAULT.photoUrl = URL.createObjectURL(t.files[0]);
    const box = t.closest('.pickphoto'); let img = box.querySelector('img');
    box.querySelectorAll('svg, b, span').forEach(n => n.remove());
    if (!img) { img = document.createElement('img'); img.alt = 'Gewähltes Foto'; box.prepend(img); }
    img.src = VAULT.photoUrl;
  }
});
let draftTimer;
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.onb) {
    const k = t.dataset.onb;
    if (k === 'email') { ONB.email = t.value; return; }
    if (k === 'claim') return;
    if (k === 'ok') { ONB.ok = t.checked; render(); return; }
    if (k === 'code') {
      ONB.code = t.value.replace(/\D/g, '').slice(0, 6); t.value = ONB.code;
      document.querySelectorAll('.otpboxes .codebox').forEach((b, i) => { b.textContent = ONB.code[i] || ''; b.classList.toggle('cur', i === ONB.code.length); });
      const btn = $('[data-act="onb-verify"]'); if (btn) btn.disabled = ONB.code.length !== 6;
      if (ONB.code.length === 6) actions['onb-verify']();
      return;
    }
    if (k === 'name') {
      ONB.name = t.value; onbSave();
      const okN = nameOk(ONB.name), btn = $('[data-act="onb-name"]'); if (btn) btn.disabled = !okN;
      const hint = t.closest('.onb-body').querySelector('p.small'); const bad = ONB.name.trim() && !okN;
      if (hint) { hint.className = 'small ' + (bad ? 'err' : 'muted'); hint.textContent = bad ? 'Nur Buchstaben und Zahlen, 2 bis 24 Zeichen, höchstens ein Leerzeichen.' : 'So sehen dich deine Buddys. Buchstaben und Zahlen, ein Leerzeichen ist erlaubt.'; }
      const avl = document.querySelector('.onb-av'); if (avl) avl.textContent = (ONB.name.trim()[0] || '?').toUpperCase();
      return;
    }
  }
  if (t.id === 'sp-size' && SPOT.ed) { SPOT.ed.textSize = +t.value; layoutEditor(); return; }
  if (view === 'bearbeiten' && edraft && (t.dataset.f || t.dataset.note != null)) { withEd(() => draftInput(t)); return; }
  if (t.id === 'pk-q' && PK) { PK.q = t.value; PK.sel = ''; renderPick(); return; }
  if (t.id === 'lf-name') { libSim(); lfCheck(); return; }
  if (t.closest && t.closest('#libform')) lfCheck();
  if (t.id === 'bud-q') { const c = t.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); BUD.q = c; if (c.length === 8) buddySearch(c); else if (BUD.found || BUD.msg) { BUD.found = null; BUD.msg = ''; budRefresh(); } return; }
  if (t.id === 'lib-q') { LIBV.q = t.value; const l = $('#lib-list'); if (l) l.innerHTML = libListHTML(); return; }
  if (t.id === 'me-q' && musEd) { musEd.q = t.value; musHits(); return; }
  if (t.id === 'sv-in') { if (SPOT.view && SPOT.view.compose === 'text') { t.style.height = ''; t.style.height = Math.min(t.scrollHeight, 132) + 'px'; } return; }
  if (t.id === 'chat-in' && CHAT.open) { (CHAT.draft = CHAT.draft || {})[CHAT.open] = t.value; return; }
  if (t.id === 'cn-q') { const v = t.value; chatNewSheet(v); const i = $('#cn-q'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } return; }
  if (draftInput(t)) return;
  if ((t.dataset.b === 'title' || t.dataset.b === 'short') && builder) {
    builder.work[builder.day][t.dataset.b] = t.dataset.b === 'short' ? t.value.toUpperCase().slice(0, 6) : t.value.trimStart();
    const was = builder.dirty[builder.day]; markDirty();
    if (was !== builder.dirty[builder.day]) { const id = t.id, pos = t.selectionStart; render(); const n = document.getElementById(id); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
  } else if (t.name === 'type' && $('#libform')) {
    const u = $('#lf-unit'); if (u) u.textContent = isTimed(t.value) ? 'Sek. von' : 'Wdh. von';
  }
});
// Eingaben in Satzfeldern und Notizen des Trainings (oder des Bearbeiten-Entwurfs)
function draftInput(t) {
  if (t.dataset.f && draft) {
    const i = +t.dataset.i, j = +t.dataset.j;
    const set = draft.items[i].sets[j];
    set[t.dataset.f] = t.value;
    if (t.dataset.f === 'w') {
      set.man = true;
      if (set.mk) { set.mk = ''; set.lab = ''; const lab = document.getElementById(`sl-${i}-${j}`); if (lab) lab.remove(); t.closest('.field').classList.remove('mk-up', 'mk-down', 'mk-deload'); }
      if (draft.items[i].ex.type === 'bw') { const f = document.getElementById(`wf-${i}-${j}`); if (f) { f.classList.toggle('plus', num(t.value) > 0 && !set.neg); f.classList.toggle('minus', num(t.value) > 0 && set.neg); } }
    }
    if (t.dataset.f === 'w' && j === 0) { const el = document.getElementById(`wu-${i}`); if (el) el.textContent = warmupLabel(draft.items[i]); }
    if (draft.edit) saveDraft(); else { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 300); }
    return true;
  }
  if (t.dataset.note != null && draft) {
    if (t.dataset.scope === 'crew') draft.items[+t.dataset.note].cnote = t.value; else draft.items[+t.dataset.note].note = t.value;
    if (draft.edit) saveDraft(); else { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 300); }
    return true;
  }
  return false;
}
document.addEventListener('pointerdown', ev => { if (view === 'spot' && ev.target.closest('#sp-stage')) edPointerDown(ev); else if (view === 'spots' && ev.target.closest('#sv')) svDown(ev); });
document.addEventListener('pointermove', ev => { if (view === 'spot') edPointerMove(ev); });
document.addEventListener('pointerup', ev => { if (view === 'spot') edPointerUp(ev); else if (view === 'spots') svUp(ev); });
document.addEventListener('pointercancel', ev => { if (view === 'spot') edPointerUp(ev); else if (view === 'spots' && SPOT.view) { SPOT.view.down = null; SPOT.view.paused = false; } });
window.addEventListener('resize', () => { if (view === 'spot') layoutEditor(); });
window.addEventListener('hashchange', () => { $('#modal').innerHTML = ''; render(); });

/* ---------- Tabs ----------
   Tab-Wechsel ersetzen den Verlaufseintrag, statt einen neuen anzulegen. So hat die Zurück-Geste von iOS zwischen den Tabs
   nichts zum Zurückblättern (vorher: kurz schwarzer Bildschirm). Dafür lässt sich zwischen den Tabs wischen: Der Inhalt
   folgt dem Finger, der nächste Tab schiebt sich herein. Kamera, Training, Spots und alles mit eigenen Wischgesten bleiben ausgenommen. */
const TABS = ['kamera', 'start', 'verlauf', 'plan', 'notizen', 'profil'];
const SWIPE_TABS = ['start', 'verlauf', 'plan', 'notizen', 'profil'];
let TAB_SLIDE = 0, SW = null;
function goTab(id, dir = 0) {
  const cur = location.hash.slice(1) || 'start';
  if (cur === id) { $('#app').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  TAB_SLIDE = dir; location.replace('#' + id);
}
function swipeTab() {
  if (!SWIPE_TABS.includes(view) || (view === 'profil' && location.hash.includes(':'))) return null;
  if ($('#modal').innerHTML || $('.savebar') || $('.museditor')) return null;
  return view;
}
function hScroll(el) {
  for (let n = el; n && n.id !== 'app'; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 2) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll') return true; }
  }
  return false;
}
function tabSlideIn() {
  const d = TAB_SLIDE; TAB_SLIDE = 0; if (!d) return;
  const m = $('#page main.view'); if (!m) return;
  m.style.transition = 'none'; m.style.transform = `translateX(${d * innerWidth * .3}px)`; m.style.opacity = '0';
  m.getBoundingClientRect();
  m.style.transition = 'transform .26s cubic-bezier(.2,.8,.2,1), opacity .2s ease-out'; m.style.transform = ''; m.style.opacity = '';
  setTimeout(() => { m.style.transition = ''; }, 300);
}
document.addEventListener('click', e => {
  const a = e.target.closest('.tabbar a[href^="#"]'); if (!a) return;
  e.preventDefault();
  const id = a.getAttribute('href').slice(1), i = TABS.indexOf(view), j = TABS.indexOf(id);
  goTab(id, id !== 'kamera' && view !== 'kamera' && i >= 0 && j >= 0 ? Math.sign(j - i) : 0);
}, true);
document.addEventListener('touchstart', e => {
  SW = null; const tab = swipeTab(); if (!tab || e.touches.length !== 1) return;
  const t = e.target, x = e.touches[0].clientX;
  if (t.closest('input, textarea, select, .tabbar, .head, [data-noswipe]') || hScroll(t) || x < 20 || x > innerWidth - 20) return;
  SW = { tab, x0: x, y0: e.touches[0].clientY, t0: Date.now(), dx: 0, lock: null, el: $('#page main.view') };
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!SW || !SW.el) return;
  const dx = e.touches[0].clientX - SW.x0, dy = e.touches[0].clientY - SW.y0;
  if (!SW.lock) {
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) SW.lock = 'x';
    else { if (Math.abs(dy) > 10) SW = null; return; }
  }
  e.preventDefault();
  const i = SWIPE_TABS.indexOf(SW.tab), has = dx < 0 ? i < SWIPE_TABS.length - 1 : i > 0;
  SW.dx = has ? dx : dx * .25;
  SW.el.style.transition = 'none'; SW.el.style.transform = `translateX(${SW.dx}px)`;
  SW.el.style.opacity = String(1 - Math.min(.35, Math.abs(SW.dx) / innerWidth * .5));
}, { passive: false });
function swipeEnd() {
  const s = SW; SW = null; if (!s || s.lock !== 'x' || !s.el) return;
  const i = SWIPE_TABS.indexOf(s.tab), dir = s.dx < 0 ? 1 : -1, next = SWIPE_TABS[i + dir];
  const v = Math.abs(s.dx) / Math.max(1, Date.now() - s.t0);
  const go = next && (Math.abs(s.dx) > innerWidth * .28 || (v > .45 && Math.abs(s.dx) > 40));
  s.el.style.transition = 'transform .17s ease-out, opacity .17s ease-out';
  if (!go) { s.el.style.transform = ''; s.el.style.opacity = ''; return; }
  s.el.style.transform = `translateX(${-dir * innerWidth}px)`; s.el.style.opacity = '0';
  setTimeout(() => goTab(next, dir), 160);
}
document.addEventListener('touchend', swipeEnd);
document.addEventListener('touchcancel', swipeEnd);

/* ---------- Start der App ---------- */
let hiddenAt = Date.now();
// Fragt bei GitHub nach einer neuen Version. Nicht während eines Trainings, damit nichts mitten im Satz neu lädt.
function checkUpdate() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:' || (view === 'training' && draft) || SPOT.ed || SPOT.view) return;
  if (Date.now() - (checkUpdate.last || 0) < 60000) return;
  checkUpdate.last = Date.now();
  navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') stopCamera(); else if (view === 'kamera') startCamera();
  if (document.visibilityState === 'visible' && TIMER) tmrTick();
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); if (draft) saveDraft(); if ((VAULT.key || VAULT.photo) && Date.now() - VAULT.picking > 180000) { lockVault(); if (view.startsWith('vault')) location.hash = '#profil'; } return; }
  checkUpdate();
  const away = Date.now() - hiddenAt;
  if (cfg.me && cfg.url && away > 60000) sync({ overlay: away > 5 * 60000 && view !== 'training' });
});
window.addEventListener('online', () => { if (cfg.me && cfg.url) sync({ quiet: true }); });
setInterval(() => {
  if (view === 'training' && draft) { const c = $('#tp-count'); if (c) c.textContent = trainCountText(); }
  if (view === 'training' && draft && cfg.url && document.visibilityState === 'visible' && !syncing && Date.now() - (setInterval.last || 0) > 60000) { setInterval.last = Date.now(); sync({ quiet: true }); }
  // im Chat alle 15 Sekunden nach neuen Nachrichten schauen
  if (['chat', 'chats'].includes(view) && cfg.url && document.visibilityState === 'visible') chatSync();
}, 15000);
/* Tastatur: Eingabeleisten (Chat, Antwort auf Spot) sitzen über der Tastatur */
// Unterkante des sichtbaren Bereichs (über der Tastatur) in Koordinaten des Bildschirms. Die Leisten hängen sich
// mit „top“ daran, so sitzen sie unabhängig davon, wie iOS die Seite beim Öffnen der Tastatur verschiebt, darüber.
function kbOffset() {
  const vv = window.visualViewport; if (!vv) return;
  const root = document.documentElement, H = parseFloat(getComputedStyle(root).getPropertyValue('--H')) || window.innerHeight;
  const bottom = vv.offsetTop + vv.height, open = H - bottom > 120 && document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  root.classList.toggle('kb', !!open);
  root.style.setProperty('--vvb', Math.round(bottom) + 'px');
  root.style.setProperty('--kbh', (open ? Math.round(H - bottom) : 0) + 'px');
  if (open && view === 'chat') { const app = $('#app'); app.scrollTop = app.scrollHeight; }
}
document.addEventListener('focusin', () => setTimeout(kbOffset, 50));
document.addEventListener('focusout', () => setTimeout(kbOffset, 50));
if (window.visualViewport) { visualViewport.addEventListener('resize', kbOffset); visualViewport.addEventListener('scroll', kbOffset); }

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  setTimeout(checkUpdate, 3000);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; if (draft) saveDraft(); location.reload(); } });
}

try { draft = normalizeDraft(draft); } catch (e) { draft = null; }
if (location.hash === '#spot' || location.hash === '#spots') location.hash = '#start';
if (cfg.me) loadChat();
render();
loadSpots().then(() => { if (cfg.me && ['start', 'kamera', 'profil', 'spot-bild'].includes(view)) render(); if (cfg.me && cfg.url && !syncing) spotSync(); });
if (cfg.me && cfg.url) sync({ overlay: true });
