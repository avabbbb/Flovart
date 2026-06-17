const fs = require('fs');
const iconv = require('iconv-lite');

function fixGarbled(garbled) {
    // Theory: garbled text is UTF-8 bytes of original Chinese, read as GBK
    // So: encode garbled as GBK → decode those bytes as UTF-8
    const gbkBytes = iconv.encode(garbled, 'gbk');
    const fixed = iconv.decode(gbkBytes, 'utf8');
    return fixed;
}

const tests = [
    '浣跨敤鏉℃',
    '闅愮鏀跨瓥',
    '娉曞緥鏂囨。寮圭獥',
    '搴曢儴娉曞緥閾炬帴',
    '鍥惧眰钂欑増缂栬緫',
    '閫夋嫨姝ゆ柟妗?',
    '鎺ㄨ枬',
    '鏈焺湴瀛樺偍绌洪棿涓嶈冻',
    '淇濆瓨鐢诲竷澶辫触',
    '钂欑増缂栬緫',
    '娓呴櫎钂欑増',
    '瀹屾垚',
    '鍙栨秷',
    '鑷渷璇婃柇鏉?',
    '閲嶇粯涓?..',
    '鉁?閲嶇粯',
    '褰撳墠',
    '鍘嗗彶',
    '鎭㈠',
    '鎿﹂櫎',
    '绗斿埛',
    '鐢ㄥ師鐢熶簨浠剁洃鍚鍣ㄦ寕杞?',
];

let report = '';
for (const t of tests) {
    const fixed = fixGarbled(t);
    report += `GARBLED: ${t}\nFIXED:   ${fixed}\n\n`;
}
fs.writeFileSync('fix_results.txt', report, 'utf8');
console.log('Done. See fix_results.txt');
