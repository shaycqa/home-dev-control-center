// Adapt SVAR CSS to our existing locally bundled Lucide icon system.
import fs from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import * as icons from "lucide-react";
const mapping = {
  folder: icons.Folder,
  file: icons.File,
  "arrow-left": icons.ArrowLeft,
  close: icons.X,
  "dots-v": icons.EllipsisVertical,
  eye: icons.Eye,
  search: icons.Search,
  "view-column": icons.Columns2,
  "view-grid": icons.LayoutGrid,
  "view-sequential": icons.List,
  "angle-right": icons.ChevronRight,
  "angle-down": icons.ChevronDown,
  "chevron-right": icons.ChevronRight,
  "chevron-down": icons.ChevronDown,
  plus: icons.Plus,
  download: icons.Download,
  upload: icons.Upload,
  edit: icons.Pencil,
  trash: icons.Trash2,
  "content-copy": icons.Copy,
  "content-cut": icons.Scissors,
  "content-paste": icons.ClipboardPaste,
  check: icons.Check,
  sort: icons.ArrowDownUp,
  refresh: icons.RefreshCw,
  "arrow-down": icons.ArrowDown,
  "arrow-right": icons.ArrowRight,
  "arrow-up": icons.ArrowUp,
  menu: icons.Menu,
};
let css =
  '.filemanager [class*="wxi-"] {display:inline-block;width:20px;height:20px;flex-shrink:0;background-color:transparent;mask-size:contain;mask-position:center;mask-repeat:no-repeat;}\n';
for (const [name, Icon] of Object.entries(mapping)) {
  const svg = renderToStaticMarkup(React.createElement(Icon, { size: 20 }));
  css += `.filemanager .wxi-${name}{background-color:currentColor;mask-image:url("data:image/svg+xml,${encodeURIComponent(svg)}")}\n`;
}
css +=
  ' .filemanager [class*="wx-willow"],.filemanager .wx-theme {--wx-font-family:-apple-system,BlinkMacSystemFont,sans-serif;--wx-color-primary:#a4efb5;--wx-color-primary-font:#16341f;--wx-font-color:#ced8e5;--wx-background:#191e26;--wx-background-alt:#212733;}\n';
await fs.writeFile("client/filemanager-icons.css", css);
