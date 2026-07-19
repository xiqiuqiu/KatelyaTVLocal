import { parseDoubanSubjectSuggest } from '@/lib/douban-subject-suggest';

/** Representative Douban `subject_suggest` payload for 「肖申克的救赎」. */
const REPRESENTATIVE_SUGGEST_PAYLOAD = [
  {
    episode: '',
    img: 'https://img2.doubanio.com/view/photo/s_ratio_poster/public/p480747492.webp',
    title: '肖申克的救赎',
    url: 'https://movie.douban.com/subject/1292052/?suggest=%E8%82%96%E7%94%B3%E5%85%8B',
    type: 'movie',
    year: '1994',
    sub_title: 'The Shawshank Redemption',
    id: '1292052',
  },
  {
    episode: '',
    img: 'https://img1.doubanio.com/f/movie/b6dc761f5e4cf04032faa969826986efbecd54bb/pics/movie/movie_default_small.png',
    title: '肖申克的救赎：主演访谈',
    url: 'https://movie.douban.com/subject/35278770/?suggest=%E8%82%96%E7%94%B3%E5%85%8B',
    type: 'movie',
    year: '2004',
    sub_title: 'The Shawshank Redemption: Cast Interviews',
    id: '35278770',
  },
];

describe('parseDoubanSubjectSuggest', () => {
  it('returns the first subject id from a representative suggest payload', () => {
    expect(parseDoubanSubjectSuggest(REPRESENTATIVE_SUGGEST_PAYLOAD)).toBe(
      '1292052'
    );
  });

  it('returns null when the payload is empty or has no usable id', () => {
    expect(parseDoubanSubjectSuggest([])).toBeNull();
    expect(parseDoubanSubjectSuggest(null)).toBeNull();
    expect(parseDoubanSubjectSuggest({})).toBeNull();
    expect(
      parseDoubanSubjectSuggest([{ title: '无 id', type: 'movie' }])
    ).toBeNull();
    expect(
      parseDoubanSubjectSuggest([{ id: '', title: '空 id' }])
    ).toBeNull();
    expect(
      parseDoubanSubjectSuggest([{ id: 'not-a-number', title: '坏 id' }])
    ).toBeNull();
  });
});
