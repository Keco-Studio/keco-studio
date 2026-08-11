import { isCreateMapPath } from './isCreateMapPath';

export type CreateMapDashboardChrome = {
  showLeftNav: boolean;
  showTopBar: boolean;
  showStudioSidebar: boolean;
  showChatPanel: boolean;
};

export function getCreateMapDashboardChrome(pathname: string | null): CreateMapDashboardChrome {
  const onCreateMap = isCreateMapPath(pathname);

  return {
    showLeftNav: true,
    showTopBar: true,
    showStudioSidebar: !onCreateMap,
    showChatPanel: !onCreateMap,
  };
}
