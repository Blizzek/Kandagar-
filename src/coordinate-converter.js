// Конвертер координат между WGS-84 и СК-42 (зона 37, Гаусс-Крюгер)
const proj4 = require('proj4');

// Определение СК-42, зона 37 (эллипсоид Красовского)
const SK42_ZONE37 = '+proj=tmerc +lat_0=0 +lon_0=39 +k=1 +x_0=37500000 +y_0=0 +ellps=krass +towgs84=24,-123,-94,0,0,0,0 +units=m +no_defs';

// WGS-84 (стандартная система GPS)
const WGS84 = 'EPSG:4326';

// Преобразователи
const toSK42 = proj4(WGS84, SK42_ZONE37);
const toWGS84 = proj4(SK42_ZONE37, WGS84);

/**
 * Конвертирует координаты из WGS-84 в СК-42
 * @param {number} lon - Долгота (longitude)
 * @param {number} lat - Широта (latitude)
 * @returns {{x: number, y: number}} - Координаты в СК-42 (x - восток, y - север)
 */
function wgs84ToSK42(lon, lat) {
    const result = toSK42.forward([lon, lat]);
    return {
        x: Math.round(result[0]), // метры по оси X (восток)
        y: Math.round(result[1])  // метры по оси Y (север)
    };
}

/**
 * Конвертирует координаты из СК-42 в WGS-84
 * @param {number} x - Координата X в СК-42 (восток)
 * @param {number} y - Координата Y в СК-42 (север)
 * @returns {{lon: number, lat: number}} - Координаты в WGS-84
 */
function sk42ToWGS84(x, y) {
    const result = toWGS84.forward([x, y]);
    return {
        lon: result[0], // долгота
        lat: result[1]  // широта
    };
}

module.exports = {
    wgs84ToSK42,
    sk42ToWGS84
};
