// 切换 Space Tab 的统一入口：DSH 视图独占 SpaceRail，切到空间标签应先退出 DSH 视图。
export function activateSpaceTab(
  wb: { dshVisible: boolean; setDshVisible: (v: boolean) => void; setActive: (path: string) => void },
  path: string,
) {
  if (wb.dshVisible) wb.setDshVisible(false)
  wb.setActive(path)
}
