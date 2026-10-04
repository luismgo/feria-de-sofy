import assert from 'node:assert/strict';
import test from 'node:test';
import { collatorEs, ordenar } from '../js/ui.js';

test('collatorEs ordena cadenas con números en orden natural (no lexicográfico)', () => {
  const entrada = ['1', '10', '11', '2', '20', '200', '3', '4', '5', '6', '7', '8', '9'];
  const esperado = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '20', '200'];

  const resultado = [...entrada].sort((a, b) => collatorEs.compare(a, b));
  assert.deepEqual(resultado, esperado);
});

test('collatorEs ordena nombres de productos tipo "Sticker N" naturalmente', () => {
  const entrada = [
    'Sticker 10',
    'Sticker 1',
    'Sticker 20',
    'Sticker 2',
    'Sticker 100',
    'Sticker 3',
  ];
  const esperado = [
    'Sticker 1',
    'Sticker 2',
    'Sticker 3',
    'Sticker 10',
    'Sticker 20',
    'Sticker 100',
  ];

  const resultado = [...entrada].sort((a, b) => collatorEs.compare(a, b));
  assert.deepEqual(resultado, esperado);
});

test('ordenar() aplica orden natural por nombre cuando no hay extractor específico', () => {
  const items = [
    { id: 10, nombre: 'Producto 10' },
    { id: 2, nombre: 'Producto 2' },
    { id: 1, nombre: 'Producto 1' },
    { id: 20, nombre: 'Producto 20' },
  ];

  const ordenados = ordenar(items, 'nombre', {}, (x) => x.nombre);
  assert.deepEqual(
    ordenados.map((x) => x.nombre),
    ['Producto 1', 'Producto 2', 'Producto 10', 'Producto 20']
  );
});

test('ordenar() desempata criterios numéricos con orden natural por nombre', () => {
  const items = [
    { nombre: 'Item 10', precio: 100 },
    { nombre: 'Item 2', precio: 100 },
    { nombre: 'Item 1', precio: 200 },
  ];
  const criterios = { precio: (x) => x.precio };

  const ordenados = ordenar(items, 'precio', criterios, (x) => x.nombre);
  assert.deepEqual(
    ordenados.map((x) => x.nombre),
    ['Item 2', 'Item 10', 'Item 1']
  );
});
