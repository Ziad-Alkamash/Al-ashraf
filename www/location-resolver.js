/* Resolve a useful local place name and its administrative parents. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AshrafLocationResolver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const clean = (value) => typeof value === 'string' ? value.trim() : '';
  const first = (...values) => values.map(clean).find(Boolean) || '';
  function hasCoordinates(location) {
    if (!location) return false;
    const lat = Number(location.lat), lng = Number(location.lng);
    return Number.isFinite(lat) && lat >= -90 && lat <= 90
      && Number.isFinite(lng) && lng >= -180 && lng <= 180;
  }
  function startupMode(savedLocation, geolocationAvailable) {
    if (hasCoordinates(savedLocation)) return 'saved-location';
    return geolocationAvailable ? 'request-device-location' : 'location-required';
  }
  function matchesPrayerTimings(meta, location, method, school, maxAgeMs) {
    if (!meta || !hasCoordinates(location)) return false;
    const ageLimit = Number.isFinite(maxAgeMs) ? maxAgeMs : Infinity;
    const precision = Number(meta.precision) === 3 ? 3 : 2; // دعم كاش النسخ القديمة
    return meta.lat === Number(location.lat).toFixed(precision)
      && meta.lng === Number(location.lng).toFixed(precision)
      && String(meta.method) === String(method)
      && String(meta.school) === String(school)
      && Date.now() - Number(meta.t || 0) <= ageLimit;
  }
  function geolocationErrorMessage(code) {
    if (Number(code) === 1) return 'اسمح للتطبيق بالوصول إلى الموقع من إعدادات الجهاز';
    if (Number(code) === 2) return 'تعذّر تحديد موقعك؛ تحقق من تفعيل خدمات الموقع وGPS';
    if (Number(code) === 3) return 'انتهت مهلة تحديد الموقع؛ حاول مرة أخرى';
    return 'تعذّر الوصول لموقعك؛ تحقق من إذن الموقع وGPS';
  }
  const unique = (values, excluded) => {
    const seen = new Set(excluded.map((x) => x.toLocaleLowerCase()));
    return values.map(clean).filter((x) => {
      const key = x.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  function resolve(address, metadata) {
    const a = address || {};
    const m = metadata || {};
    const village = first(a.village, a.hamlet, a.isolated_dwelling, a.locality, a.neighbourhood, a.suburb);
    const town = first(a.town);
    const city = first(a.city);
    const municipality = first(a.municipality);
    const district = first(a.city_district, a.district, a.county, a.state_district);
    // A village/locality inside a city remains the displayed name; its city
    // and district are retained as parent context below.
    const settlement = first(village, town, city, municipality, district,
      a.state, a.province, a.region, a.country, m.locality, m.city,
      m.principalSubdivision, m.countryName);
    const name = settlement;
    const specificityRank = village ? 1 : town ? 2 : city ? 3 : municipality ? 4 : district ? 5
      : first(a.state, a.province, a.region, m.principalSubdivision) ? 6 : 7;
    const governorate = first(a.governorate, a.state, a.province, a.region,
      a.state_district, m.principalSubdivision);
    const parentPlace = first(town, city, municipality, a.city_district, a.district,
      a.county, a.state_district, a.state, a.province, a.region,
      m.city, m.principalSubdivision);
    const country = first(a.country, m.countryName);
    const context = unique([parentPlace, governorate, country], [name]).join(' — ');
    const hierarchy = {
      village: clean(a.village),
      hamlet: clean(a.hamlet),
      locality: clean(a.locality),
      isolatedDwelling: clean(a.isolated_dwelling),
      suburb: clean(a.suburb),
      neighbourhood: clean(a.neighbourhood),
      town, city, municipality,
      cityDistrict: clean(a.city_district),
      district: clean(a.district),
      county: clean(a.county),
      stateDistrict: clean(a.state_district),
      governorate, country
    };
    return {
      name,
      specificityRank,
      settlement: name,
      context,
      parentPlace,
      governorate,
      country,
      countryCode: first(a.country_code, m.countryCode).toUpperCase() || null,
      hierarchy
    };
  }

  function fromNominatim(data) {
    if (!data || !data.address) return null;
    return resolve(data.address);
  }

  function fromBigDataCloud(data) {
    if (!data) return null;
    const admin = Array.isArray(data.localityInfo && data.localityInfo.administrative)
      ? data.localityInfo.administrative : [];
    const locality = first(data.locality,
      ...admin.filter((item) => Number(item.order) >= 7).sort((x, y) => Number(y.order) - Number(x.order)).map((item) => item.name));
    return resolve({
      village: locality,
      town: data.city,
      municipality: data.locality,
      state: data.principalSubdivision,
      country: data.countryName,
      country_code: data.countryCode
    });
  }

  function preferMoreSpecific(primary, secondary) {
    if (!primary) return secondary;
    if (!secondary) return primary;
    const selected = Number(secondary.specificityRank) < Number(primary.specificityRank) ? secondary : primary;
    const parentPlace = first(primary.parentPlace, secondary.parentPlace);
    const governorate = first(primary.governorate, secondary.governorate);
    const country = first(primary.country, secondary.country);
    return {
      ...selected,
      parentPlace: parentPlace.toLocaleLowerCase() === selected.name.toLocaleLowerCase() ? '' : parentPlace,
      governorate,
      country,
      countryCode: first(primary.countryCode, secondary.countryCode) || null,
      context: unique([parentPlace, governorate, country], [selected.name]).join(' — '),
      hierarchy: { ...secondary.hierarchy, ...primary.hierarchy }
    };
  }

  return { resolve, fromNominatim, fromBigDataCloud, preferMoreSpecific, hasCoordinates, startupMode, matchesPrayerTimings, geolocationErrorMessage };
});
