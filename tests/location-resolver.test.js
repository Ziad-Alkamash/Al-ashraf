const test = require('node:test');
const assert = require('node:assert/strict');
const resolver = require('../www/location-resolver.js');

test('city result retains city, governorate and country', () => {
  const result = resolver.fromNominatim({ address: {
    city: 'المنصورة', state: 'محافظة الدقهلية', country: 'مصر', country_code: 'eg'
  } });
  assert.equal(result.name, 'المنصورة');
  assert.equal(result.context, 'محافظة الدقهلية — مصر');
  assert.equal(result.countryCode, 'EG');
});

test('village wins over its town/city parent', () => {
  const result = resolver.fromNominatim({ address: {
    village: 'الغنيمية', town: 'فارسكور', state: 'محافظة دمياط', country: 'مصر'
  } });
  assert.equal(result.name, 'الغنيمية');
  assert.equal(result.context, 'فارسكور — محافظة دمياط — مصر');
  assert.equal(result.hierarchy.town, 'فارسكور');
});

test('locality remains selectable when city is missing', () => {
  const result = resolver.fromNominatim({ address: {
    locality: 'نجع السلام', municipality: 'مركز إسنا', state: 'الأقصر', country: 'مصر'
  } });
  assert.equal(result.name, 'نجع السلام');
  assert.match(result.context, /مركز إسنا/);
});

test('rural hamlet is used before district and governorate', () => {
  const result = resolver.fromNominatim({ address: {
    hamlet: 'عزبة النور', county: 'مركز كفر سعد', state: 'محافظة دمياط', country: 'مصر'
  } });
  assert.equal(result.name, 'عزبة النور');
  assert.equal(result.context, 'مركز كفر سعد — محافظة دمياط — مصر');
});

test('fallback hierarchy does not emit empty or undefined labels', () => {
  const result = resolver.fromNominatim({ address: { state: 'محافظة مطروح', country: 'مصر' } });
  assert.equal(result.name, 'محافظة مطروح');
  assert.equal(result.context, 'مصر');
  assert.doesNotMatch(`${result.name} ${result.context}`, /undefined|null/);
});

test('BigDataCloud fallback uses local locality ahead of city', () => {
  const result = resolver.fromBigDataCloud({
    locality: 'عابدين', city: 'القاهرة', principalSubdivision: 'محافظة القاهرة',
    countryName: 'مصر', countryCode: 'EG'
  });
  assert.equal(result.name, 'عابدين');
  assert.equal(result.context, 'القاهرة — محافظة القاهرة — مصر');
});

test('secondary locality improves a primary result that only knows the city', () => {
  const city = resolver.fromNominatim({ address: {
    city: 'المنصورة', state: 'محافظة الدقهلية', country: 'مصر'
  } });
  const locality = resolver.fromBigDataCloud({
    locality: 'قرية ميت خميس', city: 'المنصورة', principalSubdivision: 'محافظة الدقهلية',
    countryName: 'مصر', countryCode: 'EG'
  });
  const result = resolver.preferMoreSpecific(city, locality);
  assert.equal(result.name, 'قرية ميت خميس');
  assert.equal(result.context, 'المنصورة — محافظة الدقهلية — مصر');
});

test('GPS permission denied does not invent a default location', () => {
  assert.equal(resolver.startupMode(null, true), 'request-device-location');
  assert.match(resolver.geolocationErrorMessage(1), /اسمح للتطبيق/);
  assert.equal(resolver.hasCoordinates(null), false);
});

test('GPS unavailable is handled as a missing location', () => {
  assert.equal(resolver.startupMode(null, false), 'location-required');
  assert.match(resolver.geolocationErrorMessage(2), /GPS/);
});

test('offline prayer cache is accepted only for matching coordinates and settings', () => {
  const meta = { lat: '30.044', lng: '31.236', precision: 3, method: '5', school: '0', t: Date.now() };
  assert.equal(resolver.matchesPrayerTimings(meta, { lat: 30.0444, lng: 31.2357 }, '5', '0'), true);
  assert.equal(resolver.matchesPrayerTimings(meta, { lat: 31.2, lng: 30.1 }, '5', '0'), false);
  assert.equal(resolver.matchesPrayerTimings(meta, { lat: 30.0444, lng: 31.2357 }, '3', '0'), false);
});

test('older two-decimal prayer cache remains available offline during migration', () => {
  const legacy = { lat: '30.04', lng: '31.24', method: '5', school: '0', t: Date.now() };
  assert.equal(resolver.matchesPrayerTimings(legacy, { lat: 30.0444, lng: 31.2357 }, '5', '0'), true);
});

test('saved coordinates remain usable when the location permission is later denied', () => {
  assert.equal(resolver.startupMode({ lat: 30.04, lng: 31.24 }, true), 'saved-location');
  assert.equal(resolver.startupMode({ lat: 30.04, lng: 31.24 }, false), 'saved-location');
});
