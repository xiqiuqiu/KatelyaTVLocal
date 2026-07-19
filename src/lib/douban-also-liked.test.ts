import { parseDoubanAlsoLiked } from '@/lib/douban-also-liked';

/** Representative subject-page snippet for 「喜欢这部电影的人也喜欢」. */
const REPRESENTATIVE_SUBJECT_HTML = `
<div id="recommendations">
  <h2>
    <i>喜欢这部电影的人也喜欢</i>
          · · · · · ·
  </h2>
  <div class="recommendations-bd">
    <dl>
      <dt>
        <a href="https://movie.douban.com/subject/1292720/?from=subject-page">
          <img src="https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2500944103.webp" alt="阿甘正传">
        </a>
      </dt>
      <dd>
        <a href="https://movie.douban.com/subject/1292720/?from=subject-page">阿甘正传</a>
        <span class="subject-rate">9.5</span>
      </dd>
    </dl>
    <dl>
      <dt>
        <a href="http://movie.douban.com/subject/1292064/?from=subject-page">
          <img src="http://img3.doubanio.com/view/photo/s_ratio_poster/public/p479682972.webp" alt="楚门的世界">
        </a>
      </dt>
      <dd>
        <a href="http://movie.douban.com/subject/1292064/?from=subject-page">楚门的世界</a>
        <span class="subject-rate">9.4</span>
      </dd>
    </dl>
  </div>
</div>
`;

describe('parseDoubanAlsoLiked', () => {
  it('extracts also-liked items from a representative subject-page block', () => {
    expect(parseDoubanAlsoLiked(REPRESENTATIVE_SUBJECT_HTML)).toEqual([
      {
        id: '1292720',
        title: '阿甘正传',
        poster:
          'https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2500944103.webp',
        rate: '9.5',
        year: '',
      },
      {
        id: '1292064',
        title: '楚门的世界',
        poster:
          'https://img3.doubanio.com/view/photo/s_ratio_poster/public/p479682972.webp',
        rate: '9.4',
        year: '',
      },
    ]);
  });

  it('returns [] when the also-liked block is missing or markup changed', () => {
    expect(parseDoubanAlsoLiked('<html><body>no recommendations</body></html>')).toEqual(
      []
    );
    expect(
      parseDoubanAlsoLiked(
        '<div class="recommendations-bd"><p>unexpected markup</p></div>'
      )
    ).toEqual([]);
  });

  it('falls back to the dd title link when img alt is empty', () => {
    const html = `
      <div class="recommendations-bd">
        <dl>
          <dt>
            <a href="https://movie.douban.com/subject/1292720/?from=subject-page">
              <img src="https://img.example/forrest.webp" alt="">
            </a>
          </dt>
          <dd>
            <a href="https://movie.douban.com/subject/1292720/?from=subject-page">阿甘正传</a>
            <span class="subject-rate">9.5</span>
          </dd>
        </dl>
      </div>
    `;

    expect(parseDoubanAlsoLiked(html)).toEqual([
      {
        id: '1292720',
        title: '阿甘正传',
        poster: 'https://img.example/forrest.webp',
        rate: '9.5',
        year: '',
      },
    ]);
  });
});
