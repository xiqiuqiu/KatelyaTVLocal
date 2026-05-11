import { webcrypto } from 'crypto';
import { TextDecoder, TextEncoder } from 'util';
import '@testing-library/jest-dom/extend-expect';

if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}

if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder;
}

if (typeof global.crypto === 'undefined') {
  global.crypto = webcrypto;
}

// Allow router mocks.
// eslint-disable-next-line no-undef
jest.mock('next/router', () => require('next-router-mock'));
