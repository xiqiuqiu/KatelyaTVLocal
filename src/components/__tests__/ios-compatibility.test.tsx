import { render, waitFor } from '@testing-library/react';

import IOSCompatibility from '@/components/IOSCompatibility';

const setUserAgent = (userAgent: string) => {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  });
};

describe('IOSCompatibility', () => {
  afterEach(() => {
    document.documentElement.className = '';
    document.body.className = '';
  });

  it('applies iOS WebKit compatibility styles to iOS Chrome without a global transform wildcard', async () => {
    setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/148.0.7778.100 Mobile/15E148 Safari/604.1'
    );

    render(
      <IOSCompatibility>
        <div>login</div>
      </IOSCompatibility>
    );

    await waitFor(() => {
      expect(document.documentElement).toHaveClass('ios-safari');
    });

    const injectedCss = Array.from(document.head.querySelectorAll('style'))
      .map((style) => style.textContent || '')
      .join('\n');

    expect(injectedCss).toContain('.ios-safari .animate-pulse');
    expect(injectedCss).not.toContain('.ios-safari *');
    expect(injectedCss).not.toContain('transform: translateZ(0)');
  });

  it('does not apply iOS WebKit compatibility styles to Android Chrome', async () => {
    setUserAgent(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
    );

    render(
      <IOSCompatibility>
        <div>login</div>
      </IOSCompatibility>
    );

    await waitFor(() => {
      expect(document.documentElement).not.toHaveClass('ios-safari');
    });
  });
});
