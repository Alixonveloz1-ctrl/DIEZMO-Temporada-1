/* ============================================================
   normalizar-guiones.mjs
   ============================================================
   Reescribe los .md de /episodios dejando todas las cantidades,
   horas, monedas y códigos en letras, para que la narración
   suene exacta.

   Respeta intactas las líneas estructurales: el encabezado (el
   número de episodio ahí lo usa el parseador), la línea de
   duración, los separadores, los cortes de escena y las marcas
   de fin. En las líneas que van todas en mayúsculas —los textos
   en pantalla de la serie— el resultado se devuelve en
   mayúsculas para no romper el efecto.

   Uso:  node herramientas/normalizar-guiones.mjs [--simular]
   ============================================================ */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dirEpisodios = path.join(raiz, 'episodios');

// El módulo del estudio es ESM con extensión .js; se carga por URL.
const { normalizarParaVoz, REEMPLAZOS_BASE, ES_MARCA } =
  await import(pathToFileURL(path.join(raiz, 'app', 'texto.js')).href);

const simular = process.argv.includes('--simular');

function esEstructural(linea) {
  const s = linea.trim();
  return s.startsWith('#') ||
    /^\*\*Duración/i.test(s) ||
    /^-{3,}$/.test(s) ||
    /^\*\s*\*\s*\*$/.test(s) ||
    ES_MARCA(s) ||
    s === '';
}

// Una línea "de pantalla" no tiene ni una minúscula: son los mensajes que los
// Vessari proyectan en el mundo de la serie. Cuenta también «**09:00.**», que
// no tiene ninguna letra pero pertenece al mismo bloque en pantalla.
function esVersalita(linea) {
  return !/\p{Ll}/u.test(linea) && /[\p{Lu}\d]/u.test(linea);
}

let totalLineas = 0, totalCambios = 0;
const informe = [];

for (const archivo of fs.readdirSync(dirEpisodios).filter((f) => f.endsWith('.md')).sort()) {
  const ruta = path.join(dirEpisodios, archivo);
  const original = fs.readFileSync(ruta, 'utf8');
  const salida = [];
  let cambios = 0;

  for (const linea of original.split('\n')) {
    totalLineas++;
    if (esEstructural(linea)) { salida.push(linea); continue; }

    let nueva = normalizarParaVoz(linea, REEMPLAZOS_BASE);
    if (esVersalita(linea)) nueva = nueva.toUpperCase();

    if (nueva !== linea) {
      cambios++;
      informe.push({ archivo, antes: linea.trim(), despues: nueva.trim() });
    }
    salida.push(nueva);
  }

  if (!simular && cambios) fs.writeFileSync(ruta, salida.join('\n'), 'utf8');
  totalCambios += cambios;
  console.log('  ' + archivo + ': ' + cambios + ' líneas ' + (simular ? 'cambiarían' : 'reescritas'));
}

console.log('\n' + totalCambios + ' líneas de ' + totalLineas +
  (simular ? ' cambiarían' : ' reescritas'));

if (process.argv.includes('--detalle')) {
  console.log('\n── Cambios ──');
  for (const c of informe) {
    console.log('\n[' + c.archivo + ']');
    console.log('  antes:   ' + c.antes);
    console.log('  después: ' + c.despues);
  }
}
