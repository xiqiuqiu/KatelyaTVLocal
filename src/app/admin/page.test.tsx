import { redirect } from 'next/navigation';

import AdminPage from './page';
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
it.each([
  [{}, '/?settings=siteConfig&tv=0'],
  [{ section: 'videoSource', tv: '1' }, '/?settings=videoSource&tv=1'],
  [{ section: 'unknown', tv: '0' }, '/?settings=siteConfig&tv=0'],
])('opens legacy admin links inside settings (%s)', (searchParams, target) => {
  AdminPage({ searchParams });
  expect(redirect).toHaveBeenLastCalledWith(target);
});
