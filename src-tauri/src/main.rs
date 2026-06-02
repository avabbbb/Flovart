// 防止 Windows 调试器额外控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    flovart_lib::run();
}
