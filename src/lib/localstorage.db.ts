/* eslint-disable no-console */
import { AdminConfig } from './admin.types';
import {
  type AiFindSavedRecordMap,
  listAiFindSavedRecordSummaries,
  pruneAiFindSavedRecords,
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

/**
 * LocalStorage 存储实现
 * 主要用于本地开发和简单部署场景
 */
export class LocalStorage implements IStorage {
  private getStorageKey(
    prefix: string,
    userName: string,
    key?: string
  ): string {
    if (key) {
      return `katelyatv_${prefix}_${userName}_${key}`;
    }
    return `katelyatv_${prefix}_${userName}`;
  }

  // ---------- 播放记录 ----------
  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    if (typeof window === 'undefined') return null;

    try {
      const storageKey = this.getStorageKey('playrecord', userName, key);
      const data = localStorage.getItem(storageKey);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Error getting play record:', error);
      return null;
    }
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      const storageKey = this.getStorageKey('playrecord', userName, key);
      localStorage.setItem(storageKey, JSON.stringify(record));
    } catch (error) {
      console.error('Error setting play record:', error);
    }
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<{ [key: string]: PlayRecord }> {
    if (typeof window === 'undefined') return {};

    try {
      const prefix = this.getStorageKey('playrecord', userName);
      const records: { [key: string]: PlayRecord } = {};

      for (let i = 0; i < localStorage.length; i++) {
        const storageKey = localStorage.key(i);
        if (storageKey && storageKey.startsWith(prefix + '_')) {
          const key = storageKey.replace(prefix + '_', '');
          const data = localStorage.getItem(storageKey);
          if (data) {
            records[key] = JSON.parse(data);
          }
        }
      }

      return records;
    } catch (error) {
      console.error('Error getting all play records:', error);
      return {};
    }
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      const storageKey = this.getStorageKey('playrecord', userName, key);
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.error('Error deleting play record:', error);
    }
  }

  // ---------- 收藏 ----------
  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    if (typeof window === 'undefined') return null;

    try {
      const storageKey = this.getStorageKey('favorite', userName, key);
      const data = localStorage.getItem(storageKey);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Error getting favorite:', error);
      return null;
    }
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      const storageKey = this.getStorageKey('favorite', userName, key);
      localStorage.setItem(storageKey, JSON.stringify(favorite));
    } catch (error) {
      console.error('Error setting favorite:', error);
    }
  }

  async getAllFavorites(
    userName: string
  ): Promise<{ [key: string]: Favorite }> {
    if (typeof window === 'undefined') return {};

    try {
      const prefix = this.getStorageKey('favorite', userName);
      const favorites: { [key: string]: Favorite } = {};

      for (let i = 0; i < localStorage.length; i++) {
        const storageKey = localStorage.key(i);
        if (storageKey && storageKey.startsWith(prefix + '_')) {
          const key = storageKey.replace(prefix + '_', '');
          const data = localStorage.getItem(storageKey);
          if (data) {
            favorites[key] = JSON.parse(data);
          }
        }
      }

      return favorites;
    } catch (error) {
      console.error('Error getting all favorites:', error);
      return {};
    }
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      const storageKey = this.getStorageKey('favorite', userName, key);
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.error('Error deleting favorite:', error);
    }
  }

  // ---------- 用户管理 ----------
  async registerUser(userName: string, password: string): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      const storageKey = this.getStorageKey('user', userName);
      const hashedPassword = await hashPassword(password);
      const userData = {
        password: hashedPassword,
        createdAt: new Date().toISOString(),
      };
      localStorage.setItem(storageKey, JSON.stringify(userData));
    } catch (error) {
      console.error('Error registering user:', error);
      throw error;
    }
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    try {
      const storageKey = this.getStorageKey('user', userName);
      const data = localStorage.getItem(storageKey);
      if (!data) return false;

      const userData = JSON.parse(data);
      return verifyPassword(userData.password, password);
    } catch (error) {
      console.error('Error verifying user:', error);
      return false;
    }
  }

  async checkUserExist(userName: string): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    try {
      const storageKey = this.getStorageKey('user', userName);
      return localStorage.getItem(storageKey) !== null;
    } catch (error) {
      console.error('Error checking user existence:', error);
      return false;
    }
  }

  // ---------- 搜索历史 ----------
  async getSearchHistory(userName: string): Promise<string[]> {
    if (typeof window === 'undefined') return [];

    try {
      const storageKey = this.getStorageKey('searchhistory', userName);
      const data = localStorage.getItem(storageKey);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error getting search history:', error);
      return [];
    }
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      const history = await this.getSearchHistory(userName);
      // 移除重复项并添加到开头
      const newHistory = [
        keyword,
        ...history.filter((item) => item !== keyword),
      ];
      // 限制历史记录数量
      const limitedHistory = newHistory.slice(0, 50);

      const storageKey = this.getStorageKey('searchhistory', userName);
      localStorage.setItem(storageKey, JSON.stringify(limitedHistory));
    } catch (error) {
      console.error('Error adding search history:', error);
    }
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      const storageKey = this.getStorageKey('searchhistory', userName);

      if (!keyword) {
        // 删除所有搜索历史
        localStorage.removeItem(storageKey);
      } else {
        // 删除特定搜索历史
        const history = await this.getSearchHistory(userName);
        const newHistory = history.filter((item) => item !== keyword);
        localStorage.setItem(storageKey, JSON.stringify(newHistory));
      }
    } catch (error) {
      console.error('Error deleting search history:', error);
    }
  }

  // ---------- AI 找片结果记录 ----------
  private getAiFindSavedRecordsKey(userName: string): string {
    return this.getStorageKey('ai_find_saved_records', userName);
  }

  private async getAiFindSavedRecordMap(
    userName: string
  ): Promise<AiFindSavedRecordMap> {
    if (typeof window === 'undefined') return {};

    try {
      const data = localStorage.getItem(
        this.getAiFindSavedRecordsKey(userName)
      );
      return data ? (JSON.parse(data) as AiFindSavedRecordMap) : {};
    } catch (error) {
      console.error('Error getting AI find saved records:', error);
      return {};
    }
  }

  private async setAiFindSavedRecordMap(
    userName: string,
    records: AiFindSavedRecordMap
  ): Promise<void> {
    if (typeof window === 'undefined') return;

    localStorage.setItem(
      this.getAiFindSavedRecordsKey(userName),
      JSON.stringify(pruneAiFindSavedRecords(records))
    );
  }

  async getAiFindSavedRecords(
    userName: string
  ): Promise<AiFindSavedRecordSummary[]> {
    const records = await this.getAiFindSavedRecordMap(userName);
    return listAiFindSavedRecordSummaries(records);
  }

  async getAiFindSavedRecord(
    userName: string,
    id: string
  ): Promise<AiFindSavedRecord | null> {
    const records = await this.getAiFindSavedRecordMap(userName);
    return records[id] || null;
  }

  async upsertAiFindSavedRecord(
    userName: string,
    record: AiFindSavedRecord
  ): Promise<void> {
    const records = await this.getAiFindSavedRecordMap(userName);
    records[record.id] = record;
    await this.setAiFindSavedRecordMap(userName, records);
  }

  async touchAiFindSavedRecord(userName: string, id: string): Promise<void> {
    const records = await this.getAiFindSavedRecordMap(userName);
    const record = records[id];
    if (!record) return;

    records[id] = {
      ...record,
      lastOpenedAt: Date.now(),
      openedCount: record.openedCount + 1,
    };
    await this.setAiFindSavedRecordMap(userName, records);
  }

  async deleteAiFindSavedRecord(userName: string, id: string): Promise<void> {
    const records = await this.getAiFindSavedRecordMap(userName);
    delete records[id];
    await this.setAiFindSavedRecordMap(userName, records);
  }

  async clearAiFindSavedRecords(userName: string): Promise<void> {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(this.getAiFindSavedRecordsKey(userName));
  }

  // ---------- 跳过配置 ----------
  async getSkipConfig(
    userName: string,
    key: string
  ): Promise<EpisodeSkipConfig | null> {
    if (typeof window === 'undefined') return null;

    try {
      const storageKey = this.getStorageKey('skipconfig', userName, key);
      const data = localStorage.getItem(storageKey);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Error getting skip config:', error);
      return null;
    }
  }

  async setSkipConfig(
    userName: string,
    key: string,
    config: EpisodeSkipConfig
  ): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      const storageKey = this.getStorageKey('skipconfig', userName, key);
      localStorage.setItem(storageKey, JSON.stringify(config));
    } catch (error) {
      console.error('Error setting skip config:', error);
    }
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: EpisodeSkipConfig }> {
    if (typeof window === 'undefined') return {};

    try {
      const prefix = this.getStorageKey('skipconfig', userName);
      const configs: { [key: string]: EpisodeSkipConfig } = {};

      for (let i = 0; i < localStorage.length; i++) {
        const storageKey = localStorage.key(i);
        if (storageKey && storageKey.startsWith(prefix + '_')) {
          const key = storageKey.replace(prefix + '_', '');
          const data = localStorage.getItem(storageKey);
          if (data) {
            configs[key] = JSON.parse(data);
          }
        }
      }

      return configs;
    } catch (error) {
      console.error('Error getting all skip configs:', error);
      return {};
    }
  }

  async deleteSkipConfig(userName: string, key: string): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      const storageKey = this.getStorageKey('skipconfig', userName, key);
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.error('Error deleting skip config:', error);
    }
  }

  // ---------- 管理员功能 ----------
  async getAllUsers(): Promise<string[]> {
    if (typeof window === 'undefined') return [];

    try {
      const users: string[] = [];
      const prefix = 'katelyatv_user_';

      for (let i = 0; i < localStorage.length; i++) {
        const storageKey = localStorage.key(i);
        if (storageKey && storageKey.startsWith(prefix)) {
          const userName = storageKey.replace(prefix, '');
          users.push(userName);
        }
      }

      return users;
    } catch (error) {
      console.error('Error getting all users:', error);
      return [];
    }
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    if (typeof window === 'undefined') return null;

    try {
      const data = localStorage.getItem('katelyatv_admin_config');
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Error getting admin config:', error);
      return null;
    }
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      localStorage.setItem('katelyatv_admin_config', JSON.stringify(config));
    } catch (error) {
      console.error('Error setting admin config:', error);
    }
  }

  // ---------- 用户管理（管理员功能）----------
  async changePassword(userName: string, newPassword: string): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      const storageKey = this.getStorageKey('user', userName);
      const data = localStorage.getItem(storageKey);
      if (!data) {
        throw new Error('用户不存在');
      }

      const userData = JSON.parse(data);
      userData.password = await hashPassword(newPassword);
      userData.updatedAt = new Date().toISOString();
      localStorage.setItem(storageKey, JSON.stringify(userData));
    } catch (error) {
      console.error('Error changing password:', error);
      throw error;
    }
  }

  async upgradeLegacyPasswords(): Promise<number> {
    if (typeof window === 'undefined') return 0;

    let upgraded = 0;
    try {
      const userNames = await this.getAllUsers();
      for (const userName of userNames) {
        const storageKey = this.getStorageKey('user', userName);
        const data = localStorage.getItem(storageKey);
        if (!data) continue;

        const userData = JSON.parse(data) as {
          password?: string;
          updatedAt?: string;
        };
        if (
          !userData.password ||
          !isLegacyPlaintextPassword(userData.password)
        ) {
          continue;
        }

        userData.password = await hashPassword(userData.password);
        userData.updatedAt = new Date().toISOString();
        localStorage.setItem(storageKey, JSON.stringify(userData));
        upgraded += 1;
      }

      return upgraded;
    } catch (error) {
      console.error('Error upgrading legacy passwords:', error);
      throw error;
    }
  }

  async deleteUser(userName: string): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      // 删除用户账号
      const userKey = this.getStorageKey('user', userName);
      localStorage.removeItem(userKey);

      // 删除用户相关的所有数据
      const prefixes = [
        'playrecord',
        'favorite',
        'searchhistory',
        'ai_find_saved_records',
        'skipconfig',
      ];

      for (const prefix of prefixes) {
        const dataPrefix = this.getStorageKey(prefix, userName);
        const keysToRemove: string[] = [];

        for (let i = 0; i < localStorage.length; i++) {
          const storageKey = localStorage.key(i);
          if (
            storageKey &&
            (storageKey === dataPrefix ||
              storageKey.startsWith(dataPrefix + '_'))
          ) {
            keysToRemove.push(storageKey);
          }
        }

        keysToRemove.forEach((key) => localStorage.removeItem(key));
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      throw error;
    }
  }
}
