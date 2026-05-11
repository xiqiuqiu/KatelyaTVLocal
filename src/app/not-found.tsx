import Link from 'next/link';

export const runtime = 'edge';

export default function NotFound() {
  return (
    <div className='flex min-h-screen items-center justify-center bg-slate-50 px-4'>
      <div className='w-full max-w-lg rounded-3xl bg-white p-10 text-center shadow-xl'>
        <div className='mb-4 text-sm font-medium uppercase tracking-[0.3em] text-slate-400'>
          404
        </div>
        <h1 className='mb-3 text-3xl font-semibold text-slate-900'>
          页面不存在
        </h1>
        <p className='mb-8 text-sm leading-6 text-slate-500'>
          你访问的地址不存在，或者已经被移动。
        </p>
        <Link
          href='/'
          className='inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-700'
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}
