/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { AdminConfig } from './admin.types';
import {
  AI_FIND_SAVED_RECORD_LIMIT,
  summarizeAiFindSavedRecord,
} from './ai-find/saved-records';
import {
  hashPassword,
  isLegacyPlaintextPassword,
  verifyPassword,
} from './security/password';
import {
  AiFindSavedRecord,
  AiFindSavedRecordSummary,
  EpisodeSkipConfig,
  Favorite,
  IStorage,
  PlayRecord,
} from './types';

// 搜索历史最大条数
const SEARCH_HISTORY_LIMIT = 20;

// D1 数据库接口
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  exec(sql: string): Promise<D1ExecResult>;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = any>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = any>(): Promise<D1Result<T>>;
}

interface D1Result<T = any> {
  results: T[];
  success: boolean;
  error?: string;
  meta: {
    changed_db: boolean;
    changes: number;
    last_row_id: number;
    duration: number;
  };
}

interface D1ExecResult {
  count: number;
  duration: number;
}

// 获取全局D1数据库实例
function getD1Database(): D1Database {
  return (process.env as any).DB as D1Database;
}

export class D1Storage implements IStorage {
  private db: D1Database | null = null;

  private async getDatabase(): Promise<D1Database> {
    if (!this.db) {
      this.db = getD1Database();
    }
    return this.db;
  }

  private mapPlayRecordRow(row: any): PlayRecord {
    return {
      title: row.title,
      source_name: row.source_name,
      cover: row.cover,
      year: row.year,
      index: row.index_episode,
      total_episodes: row.total_episodes,
      play_time: row.play_time,
      total_time: row.total_time,
      save_time: row.save_time,
      search_title: row.search_title || undefined,
      route_source: row.route_source || undefined,
      route_id: row.route_id || undefined,
    };
  }

  // 播放记录相关
  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM play_records WHERE username = ? AND key = ?')
        .bind(userName, key)
        .first<any>();

      if (!result) return null;

      return this.mapPlayRecordRow(result);
    } catch (err) {
      console.error('Failed to get play record:', err);
      throw err;
    }
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `
          INSERT INTO play_records 
          (username, key, title, source_name, cover, year, index_episode, total_episodes, play_time, total_time, save_time, search_title, route_source, route_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(username, key) DO UPDATE SET
            title = excluded.title,
            source_name = excluded.source_name,
            cover = excluded.cover,
            year = excluded.year,
            index_episode = excluded.index_episode,
            total_episodes = excluded.total_episodes,
            play_time = excluded.play_time,
            total_time = excluded.total_time,
            save_time = excluded.save_time,
            search_title = excluded.search_title,
            route_source = excluded.route_source,
            route_id = excluded.route_id
        `
        )
        .bind(
          userName,
          key,
          record.title,
          record.source_name,
          record.cover,
          record.year,
          record.index,
          record.total_episodes,
          record.play_time,
          record.total_time,
          record.save_time,
          record.search_title || null,
          record.route_source || null,
          record.route_id || null
        )
        .run();
    } catch (err) {
      console.error('Failed to set play record:', err);
      throw err;
    }
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT * FROM play_records WHERE username = ? ORDER BY save_time DESC'
        )
        .bind(userName)
        .all<any>();

      const records: Record<string, PlayRecord> = {};

      result.results.forEach((row: any) => {
        records[row.key] = this.mapPlayRecordRow(row);
      });

      return records;
    } catch (err) {
      console.error('Failed to get all play records:', err);
      throw err;
    }
  }

  async getRecentPlayRecords(
    userName: string,
    limit: number
  ): Promise<Record<string, PlayRecord>> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT * FROM play_records WHERE username = ? ORDER BY save_time DESC LIMIT ?'
        )
        .bind(userName, limit)
        .all<any>();

      const records: Record<string, PlayRecord> = {};
      result.results.forEach((row: any) => {
        records[row.key] = this.mapPlayRecordRow(row);
      });

      return records;
    } catch (err) {
      console.error('Failed to get recent play records:', err);
      throw err;
    }
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM play_records WHERE username = ? AND key = ?')
        .bind(userName, key)
        .run();
    } catch (err) {
      console.error('Failed to delete play record:', err);
      throw err;
    }
  }

  async clearAllPlayRecords(userName: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM play_records WHERE username = ?')
        .bind(userName)
        .run();
    } catch (err) {
      console.error('Failed to clear play records:', err);
      throw err;
    }
  }

  // 收藏相关
  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM favorites WHERE username = ? AND key = ?')
        .bind(userName, key)
        .first<any>();

      if (!result) return null;

      return {
        title: result.title,
        source_name: result.source_name,
        cover: result.cover,
        year: result.year,
        total_episodes: result.total_episodes,
        save_time: result.save_time,
        search_title: result.search_title,
      };
    } catch (err) {
      console.error('Failed to get favorite:', err);
      throw err;
    }
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `
          INSERT OR REPLACE INTO favorites 
          (username, key, title, source_name, cover, year, total_episodes, save_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .bind(
          userName,
          key,
          favorite.title,
          favorite.source_name,
          favorite.cover,
          favorite.year,
          favorite.total_episodes,
          favorite.save_time
        )
        .run();
    } catch (err) {
      console.error('Failed to set favorite:', err);
      throw err;
    }
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT * FROM favorites WHERE username = ? ORDER BY save_time DESC'
        )
        .bind(userName)
        .all<any>();

      const favorites: Record<string, Favorite> = {};

      result.results.forEach((row: any) => {
        favorites[row.key] = {
          title: row.title,
          source_name: row.source_name,
          cover: row.cover,
          year: row.year,
          total_episodes: row.total_episodes,
          save_time: row.save_time,
          search_title: row.search_title,
        };
      });

      return favorites;
    } catch (err) {
      console.error('Failed to get all favorites:', err);
      throw err;
    }
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM favorites WHERE username = ? AND key = ?')
        .bind(userName, key)
        .run();
    } catch (err) {
      console.error('Failed to delete favorite:', err);
      throw err;
    }
  }

  // 用户相关
  async registerUser(userName: string, password: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      const hashedPassword = await hashPassword(password);
      await db
        .prepare('INSERT INTO users (username, password) VALUES (?, ?)')
        .bind(userName, hashedPassword)
        .run();
    } catch (err) {
      console.error('Failed to register user:', err);
      throw err;
    }
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT password FROM users WHERE username = ?')
        .bind(userName)
        .first<{ password: string }>();

      return result ? verifyPassword(result.password, password) : false;
    } catch (err) {
      console.error('Failed to verify user:', err);
      throw err;
    }
  }

  async checkUserExist(userName: string): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT 1 FROM users WHERE username = ?')
        .bind(userName)
        .first();

      return result !== null;
    } catch (err) {
      console.error('Failed to check user existence:', err);
      throw err;
    }
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      const hashedPassword = await hashPassword(newPassword);
      await db
        .prepare('UPDATE users SET password = ? WHERE username = ?')
        .bind(hashedPassword, userName)
        .run();
    } catch (err) {
      console.error('Failed to change password:', err);
      throw err;
    }
  }

  async upgradeLegacyPasswords(): Promise<number> {
    try {
      const db = await this.getDatabase();
      const rows = await db
        .prepare('SELECT username, password FROM users')
        .all<{ username: string; password: string }>();

      let upgraded = 0;
      for (const row of rows.results) {
        if (!isLegacyPlaintextPassword(row.password)) {
          continue;
        }

        const hashedPassword = await hashPassword(row.password);
        await db
          .prepare('UPDATE users SET password = ? WHERE username = ?')
          .bind(hashedPassword, row.username)
          .run();
        upgraded += 1;
      }

      return upgraded;
    } catch (err) {
      console.error('Failed to upgrade legacy passwords:', err);
      throw err;
    }
  }

  async deleteUser(userName: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      const statements = [
        db.prepare('DELETE FROM users WHERE username = ?').bind(userName),
        db
          .prepare('DELETE FROM play_records WHERE username = ?')
          .bind(userName),
        db.prepare('DELETE FROM favorites WHERE username = ?').bind(userName),
        db
          .prepare('DELETE FROM search_history WHERE username = ?')
          .bind(userName),
        db
          .prepare('DELETE FROM ai_find_saved_records WHERE username = ?')
          .bind(userName),
      ];

      await db.batch(statements);
    } catch (err) {
      console.error('Failed to delete user:', err);
      throw err;
    }
  }

  // 搜索历史相关
  async getSearchHistory(userName: string): Promise<string[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT keyword FROM search_history WHERE username = ? ORDER BY created_at DESC LIMIT ?'
        )
        .bind(userName, SEARCH_HISTORY_LIMIT)
        .all<{ keyword: string }>();

      return result.results.map((row) => row.keyword);
    } catch (err) {
      console.error('Failed to get search history:', err);
      throw err;
    }
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      // 先删除可能存在的重复记录
      await db
        .prepare(
          'DELETE FROM search_history WHERE username = ? AND keyword = ?'
        )
        .bind(userName, keyword)
        .run();

      // 添加新记录
      await db
        .prepare('INSERT INTO search_history (username, keyword) VALUES (?, ?)')
        .bind(userName, keyword)
        .run();

      // 保持历史记录条数限制
      await db
        .prepare(
          `
          DELETE FROM search_history 
          WHERE username = ? AND id NOT IN (
            SELECT id FROM search_history 
            WHERE username = ? 
            ORDER BY created_at DESC 
            LIMIT ?
          )
        `
        )
        .bind(userName, userName, SEARCH_HISTORY_LIMIT)
        .run();
    } catch (err) {
      console.error('Failed to add search history:', err);
      throw err;
    }
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      if (keyword) {
        await db
          .prepare(
            'DELETE FROM search_history WHERE username = ? AND keyword = ?'
          )
          .bind(userName, keyword)
          .run();
      } else {
        await db
          .prepare('DELETE FROM search_history WHERE username = ?')
          .bind(userName)
          .run();
      }
    } catch (err) {
      console.error('Failed to delete search history:', err);
      throw err;
    }
  }

  private mapAiFindSavedRecordRow(row: any): AiFindSavedRecord {
    return {
      id: row.id,
      userName: row.username,
      query: row.query,
      response: JSON.parse(row.response_json),
      status: row.status === 'complete' ? 'complete' : 'partial',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastOpenedAt: row.last_opened_at,
      openedCount: row.opened_count,
    };
  }

  async getAiFindSavedRecords(
    userName: string
  ): Promise<AiFindSavedRecordSummary[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          `
          SELECT id, username, query, response_json, status, created_at,
                 updated_at, last_opened_at, opened_count
          FROM ai_find_saved_records
          WHERE username = ?
          ORDER BY updated_at DESC
          LIMIT ?
        `
        )
        .bind(userName, AI_FIND_SAVED_RECORD_LIMIT)
        .all<any>();

      return result.results.map((row) =>
        summarizeAiFindSavedRecord(this.mapAiFindSavedRecordRow(row))
      );
    } catch (err) {
      console.error('Failed to get AI find saved records:', err);
      throw err;
    }
  }

  async getAiFindSavedRecord(
    userName: string,
    id: string
  ): Promise<AiFindSavedRecord | null> {
    try {
      const db = await this.getDatabase();
      const row = await db
        .prepare(
          `
          SELECT id, username, query, response_json, status, created_at,
                 updated_at, last_opened_at, opened_count
          FROM ai_find_saved_records
          WHERE username = ? AND id = ?
        `
        )
        .bind(userName, id)
        .first<any>();

      return row ? this.mapAiFindSavedRecordRow(row) : null;
    } catch (err) {
      console.error('Failed to get AI find saved record:', err);
      throw err;
    }
  }

  async upsertAiFindSavedRecord(
    userName: string,
    record: AiFindSavedRecord
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `
          INSERT INTO ai_find_saved_records (
            id, username, query, response_json, status, created_at,
            updated_at, last_opened_at, opened_count
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(username, id) DO UPDATE SET
            query = excluded.query,
            response_json = excluded.response_json,
            status = excluded.status,
            updated_at = excluded.updated_at
            -- last_opened_at and opened_count intentionally omitted:
            -- they are managed by touchAiFindSavedRecord (called on open).
        `
        )
        .bind(
          record.id,
          userName,
          record.query,
          JSON.stringify(record.response),
          record.status,
          record.createdAt,
          record.updatedAt,
          record.lastOpenedAt,
          record.openedCount
        )
        .run();

      await db
        .prepare(
          `
          DELETE FROM ai_find_saved_records
          WHERE username = ?
          AND id NOT IN (
            SELECT id FROM ai_find_saved_records
            WHERE username = ?
            ORDER BY updated_at DESC
            LIMIT ?
          )
        `
        )
        .bind(userName, userName, AI_FIND_SAVED_RECORD_LIMIT)
        .run();
    } catch (err) {
      console.error('Failed to upsert AI find saved record:', err);
      throw err;
    }
  }

  async touchAiFindSavedRecord(userName: string, id: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `
          UPDATE ai_find_saved_records
          SET last_opened_at = ?, opened_count = opened_count + 1
          WHERE username = ? AND id = ?
        `
        )
        .bind(Date.now(), userName, id)
        .run();
    } catch (err) {
      console.error('Failed to touch AI find saved record:', err);
      throw err;
    }
  }

  async deleteAiFindSavedRecord(userName: string, id: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          'DELETE FROM ai_find_saved_records WHERE username = ? AND id = ?'
        )
        .bind(userName, id)
        .run();
    } catch (err) {
      console.error('Failed to delete AI find saved record:', err);
      throw err;
    }
  }

  async clearAiFindSavedRecords(userName: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM ai_find_saved_records WHERE username = ?')
        .bind(userName)
        .run();
    } catch (err) {
      console.error('Failed to clear AI find saved records:', err);
      throw err;
    }
  }

  // 用户列表
  async getAllUsers(): Promise<string[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT username FROM users ORDER BY created_at ASC')
        .all<{ username: string }>();

      return result.results.map((row) => row.username);
    } catch (err) {
      console.error('Failed to get all users:', err);
      throw err;
    }
  }

  // 管理员配置相关
  async getAdminConfig(): Promise<AdminConfig | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT config FROM admin_config WHERE id = 1')
        .first<{ config: string }>();

      if (!result) return null;

      return JSON.parse(result.config) as AdminConfig;
    } catch (err) {
      console.error('Failed to get admin config:', err);
      throw err;
    }
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          'INSERT OR REPLACE INTO admin_config (id, config) VALUES (1, ?)'
        )
        .bind(JSON.stringify(config))
        .run();
    } catch (err) {
      console.error('Failed to set admin config:', err);
      throw err;
    }
  }

  // 跳过配置相关
  async getSkipConfig(
    userName: string,
    key: string
  ): Promise<EpisodeSkipConfig | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM skip_configs WHERE username = ? AND key = ?')
        .bind(userName, key)
        .first<any>();

      if (!result) return null;

      return {
        source: result.source,
        id: result.video_id,
        title: result.title,
        segments: JSON.parse(result.segments),
        updated_time: result.updated_time,
      };
    } catch (err) {
      console.error('Failed to get skip config:', err);
      throw err;
    }
  }

  async setSkipConfig(
    userName: string,
    key: string,
    config: EpisodeSkipConfig
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `
          INSERT OR REPLACE INTO skip_configs 
          (username, key, source, video_id, title, segments, updated_time)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        )
        .bind(
          userName,
          key,
          config.source,
          config.id,
          config.title,
          JSON.stringify(config.segments),
          config.updated_time
        )
        .run();
    } catch (err) {
      console.error('Failed to set skip config:', err);
      throw err;
    }
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: EpisodeSkipConfig }> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM skip_configs WHERE username = ?')
        .bind(userName)
        .all<any>();

      const configs: { [key: string]: EpisodeSkipConfig } = {};

      for (const row of result.results) {
        configs[row.key] = {
          source: row.source,
          id: row.video_id,
          title: row.title,
          segments: JSON.parse(row.segments),
          updated_time: row.updated_time,
        };
      }

      return configs;
    } catch (err) {
      console.error('Failed to get all skip configs:', err);
      throw err;
    }
  }

  async deleteSkipConfig(userName: string, key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM skip_configs WHERE username = ? AND key = ?')
        .bind(userName, key)
        .run();
    } catch (err) {
      console.error('Failed to delete skip config:', err);
      throw err;
    }
  }
}
