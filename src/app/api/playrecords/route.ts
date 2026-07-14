/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  normalizePlayRecordLimit,
  parsePlayRecordKey,
} from '@/lib/play-record-key';
import { PlayRecord } from '@/lib/types';
import { isWatchProgressStorageKey } from '@/lib/watch-progress';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = await getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = normalizePlayRecordLimit(searchParams.get('limit'));
    const records =
      limit === undefined
        ? await db.getAllPlayRecords(authInfo.username)
        : await db.getRecentPlayRecords(authInfo.username, limit);
    return NextResponse.json(records, { status: 200 });
  } catch (err) {
    console.error('获取播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = await getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { key, record }: { key: string; record: PlayRecord } = body;

    if (!key || !record) {
      return NextResponse.json(
        { error: 'Missing key or record' },
        { status: 400 }
      );
    }

    // 验证播放记录数据
    if (!record.title || !record.source_name || record.index < 1) {
      return NextResponse.json(
        { error: 'Invalid record data' },
        { status: 400 }
      );
    }

    const finalRecord = {
      ...record,
      save_time: record.save_time ?? Date.now(),
    } as PlayRecord;

    if (isWatchProgressStorageKey(key)) {
      await db.savePlayRecordByKey(authInfo.username, key, finalRecord);
      return NextResponse.json({ success: true }, { status: 200 });
    }

    // 从key中解析source和id
    const parsedKey = parsePlayRecordKey(key);
    if (!parsedKey) {
      return NextResponse.json(
        { error: 'Invalid key format' },
        { status: 400 }
      );
    }

    await db.savePlayRecord(
      authInfo.username,
      parsedKey.source,
      parsedKey.id,
      finalRecord
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('保存播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = await getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const username = authInfo.username;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      if (isWatchProgressStorageKey(key)) {
        await db.deletePlayRecordByKey(username, key);
        return NextResponse.json({ success: true }, { status: 200 });
      }

      // 如果提供了 key，删除单条播放记录
      const parsedKey = parsePlayRecordKey(key);
      if (!parsedKey) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 }
        );
      }

      await db.deletePlayRecord(username, parsedKey.source, parsedKey.id);
    } else {
      await db.clearAllPlayRecords(username);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('删除播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
