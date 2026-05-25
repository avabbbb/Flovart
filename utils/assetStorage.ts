/**
 * ============================================
 * 素材存储工具 (Asset Storage)
 * ============================================
 * 
 * 【模块职责】
 * 负责灵感库数据的本地持久化存储，使用 localStorage 实现
 * 
 * 【核心功能】
 * 1. 加载素材库：从 localStorage 读取用户的素材数据
 * 2. 保存素材库：将素材数据写入 localStorage
 * 3. 添加素材：新增素材到指定分类，并自动保存
 * 4. 删除素材：从指定分类移除素材，并自动保存
 * 5. 重命名素材：修改素材名称，并自动保存
 * 
 * 【数据结构】
 * AssetLibrary = {
 *   character: AssetItem[],  // 角色素材数组
 *   scene: AssetItem[],      // 场景素材数组
 *   prop: AssetItem[]        // 道具素材数组
 * }
 * 
 * AssetItem = {
 *   id: string,              // 唯一标识
 *   category: string,        // 所属分类
 *   name: string,            // 素材名称
 *   dataUrl: string,         // Base64图片数据
 *   width: number,           // 图片宽度
 *   height: number,          // 图片高度
 *   createdAt: number        // 创建时间戳
 * }
 * 
 * 【设计模式】
 * - 函数式编程：所有操作都是纯函数，返回新的数据而不修改原数据
 * - 自动保存：增删改操作会自动触发保存，确保数据一致性
 * - 容错处理：加载失败时返回空数据结构，确保应用不崩溃
 * 
 * 【存储键名】
 * 使用版本化的存储键 'making.assetLibrary.v1'，方便未来数据格式升级
 */

import type { AssetLibrary, AssetItem, AssetCategory } from '../types';
import { offloadDataUrlRecords, rehydrateDataUrlRecords } from './mediaIndexedDBSentry';

// localStorage 存储键名（带版本号）
const STORAGE_KEY = 'making.assetLibrary.v1';

/**
 * 【函数】加载素材库
 * 
 * 从 localStorage 读取素材库数据
 * 
 * @returns {AssetLibrary} 素材库对象，包含三个分类的素材数组
 * 
 * 【实现逻辑】
 * 1. 尝试从 localStorage 读取数据
 * 2. 如果不存在，返回空的素材库结构
 * 3. 解析 JSON 数据并验证结构完整性
 * 4. 如果解析失败，返回空的素材库结构（容错）
 * 
 * 【容错设计】
 * - 数据不存在时返回空结构
 * - 解析失败时返回空结构
 * - 缺少分类时补充空数组
 */
export const loadAssetLibrary = (): AssetLibrary => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { character: [], scene: [], prop: [] };
        
        const parsed = JSON.parse(raw) as AssetLibrary;
        // 确保三个分类都存在（防止数据不完整）
        return {
            character: parsed.character || [],
            scene: parsed.scene || [],
            prop: parsed.prop || [],
        };
    } catch {
        // 解析失败时返回空结构（容错处理）
        return { character: [], scene: [], prop: [] };
    }
};

/**
 * 【函数】保存素材库
 * 
 * 将素材库数据写入 localStorage
 * 
 * @param {AssetLibrary} lib - 要保存的素材库对象
 * 
 * 【实现逻辑】
 * 1. 将素材库对象序列化为 JSON 字符串
 * 2. 存储到 localStorage
 * 
 * 【注意事项】
 * - localStorage 有存储大小限制（通常 5-10MB）
 * - Base64 图片数据会占用较多空间
 * - 生产环境可考虑使用 IndexedDB 或云存储
 */
export const saveAssetLibrary = (lib: AssetLibrary) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
    } catch (err) {
        console.error('[Storage] Failed to save asset library', err);
    }
};

export const saveAssetLibraryAsync = async (lib: AssetLibrary): Promise<void> => {
    const slim: AssetLibrary = {
        character: await offloadDataUrlRecords(lib.character, 'asset'),
        scene: await offloadDataUrlRecords(lib.scene, 'asset'),
        prop: await offloadDataUrlRecords(lib.prop, 'asset'),
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch (err) {
        console.error('[Storage] Failed to save asset library', err);
    }
};

export const loadAssetLibraryAsync = async (): Promise<AssetLibrary> => {
    const lib = loadAssetLibrary();
    return {
        character: await rehydrateDataUrlRecords(lib.character),
        scene: await rehydrateDataUrlRecords(lib.scene),
        prop: await rehydrateDataUrlRecords(lib.prop),
    };
};

/**
 * 【函数】添加素材
 * 
 * 将新素材添加到指定分类，并自动保存
 * 
 * @param {AssetLibrary} lib - 当前素材库
 * @param {AssetItem} item - 要添加的素材项（需包含 category 字段）
 * @returns {AssetLibrary} 添加后的新素材库对象
 * 
 * 【实现逻辑】
 * 1. 创建新的素材库对象（不修改原对象，保持不可变性）
 * 2. 将新素材添加到对应分类的数组开头（最新的在前面）
 * 3. 自动调用 saveAssetLibrary 保存到 localStorage
 * 4. 返回新的素材库对象
 * 
 * 【设计亮点】
 * - 使用扩展运算符创建新对象，避免修改原数据
 * - 新素材放在数组开头，符合"最新优先"的用户习惯
 * - 操作后自动保存，确保数据一致性
 */
export const addAsset = (lib: AssetLibrary, item: AssetItem): AssetLibrary => {
    if (lib[item.category].some(existing => existing.id === item.id || existing.dataUrl === item.dataUrl)) {
        return lib;
    }

    // 创建新的素材库对象，将新素材添加到对应分类的开头
    const next: AssetLibrary = { 
        ...lib, 
        [item.category]: [item, ...lib[item.category]] 
    } as AssetLibrary;
    
    return next;
};

/**
 * 【函数】删除素材
 * 
 * 从指定分类中删除素材，并自动保存
 * 
 * @param {AssetLibrary} lib - 当前素材库
 * @param {AssetCategory} category - 素材所属分类
 * @param {string} id - 要删除的素材ID
 * @returns {AssetLibrary} 删除后的新素材库对象
 * 
 * 【实现逻辑】
 * 1. 创建新的素材库对象
 * 2. 过滤掉指定ID的素材
 * 3. 自动保存更新后的数据
 * 4. 返回新的素材库对象
 * 
 * 【使用场景】
 * - 用户主动删除不需要的素材
 * - 清理过期或重复的素材
 */
export const removeAsset = (lib: AssetLibrary, category: AssetCategory, id: string): AssetLibrary => {
    // 创建新对象，过滤掉要删除的素材
    const next: AssetLibrary = { 
        ...lib, 
        [category]: lib[category].filter(a => a.id !== id) 
    } as AssetLibrary;
    
    return next;
};

/**
 * 【函数】重命名素材
 * 
 * 修改指定素材的名称，并自动保存
 * 
 * @param {AssetLibrary} lib - 当前素材库
 * @param {AssetCategory} category - 素材所属分类
 * @param {string} id - 要重命名的素材ID
 * @param {string} name - 新的素材名称
 * @returns {AssetLibrary} 重命名后的新素材库对象
 * 
 * 【实现逻辑】
 * 1. 创建新的素材库对象
 * 2. 找到目标素材，更新其 name 字段
 * 3. 其他素材保持不变
 * 4. 自动保存更新后的数据
 * 5. 返回新的素材库对象
 * 
 * 【使用场景】
 * - 用户双击素材名称进行重命名
 * - 为素材添加更有意义的名称
 * - 方便后续查找和管理
 */
export const renameAsset = (lib: AssetLibrary, category: AssetCategory, id: string, name: string): AssetLibrary => {
    // 创建新对象，更新指定素材的 name 字段
    const next: AssetLibrary = { 
        ...lib, 
        [category]: lib[category].map(a => a.id === id ? { ...a, name } : a) 
    } as AssetLibrary;
    
    return next;
};

