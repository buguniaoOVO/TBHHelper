def main():
    import types
    # Install the shell identity before Tk creates its first native window.
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(
        ctypes.c_wchar_p('TBH.Helper.BlackYellow'))
    original_tk_init = tk.Tk.__init__
    original_app_init = App.__init__

    def hidden_tk_init(window, *args, **kwargs):
        original_tk_init(window, *args, **kwargs)
        window.withdraw()
        window.iconbitmap(str(BUNDLE_DIR / 'app_icon.ico'))

    def branded_app_init(window, *args, **kwargs):
        original_app_init(window, *args, **kwargs)
        window.update_idletasks()
        window._ui_sync_native_brand_icons()
        window.deiconify()
        # The preserved entry point installs its close handler after App() returns.
        window.after_idle(lambda: window.protocol('WM_DELETE_WINDOW', window._ui_close_to_tray))

    original_main = types.FunctionType('__TBH_ORIGINAL_MAIN_CODE__', globals(), 'main')
    tk.Tk.__init__ = hidden_tk_init
    App.__init__ = branded_app_init
    try:
        return original_main()
    finally:
        tk.Tk.__init__ = original_tk_init
        App.__init__ = original_app_init


def _configure_theme(self):
    colors = {
        'background': '#FFFFFF',
        'panel': '#FFFFFF',
        'panel_alt': '#F5F7FA',
        'field': '#F5F7FA',
        'border': '#D9E2EF',
        'text': '#183451',
        'muted': '#5C7695',
        'accent': '#087D91',
        'accent_hover': '#066A7D',
        'disabled': '#9AA9B9',
    }
    UI_COLORS.update(colors)
    # Preserve the game palette's hues and give text a readable light-theme value.
    GRADE_COLORS.update({
        '普通': '#626262', '罕见': '#4C742F', '稀有': '#345AA4',
        '传奇': '#8F5320', '不朽': '#AA413C', '至宝': '#8146B2',
        '超凡': '#B53762', '天界': '#286E8C', '神圣': '#796428',
        '宇宙': '#2F6E94',
    })
    self.configure(background=colors['background'])
    self.tk_setPalette(background=colors['panel'], foreground=colors['text'],
                       activeBackground=colors['panel_alt'], activeForeground=colors['text'],
                       selectBackground=colors['border'], selectForeground=colors['text'])
    try:
        self.iconbitmap(str(BUNDLE_DIR / 'app_icon.ico'))
    except Exception:
        pass
    try:
        # Keep a stable identity for the helper's taskbar group.
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(
            ctypes.c_wchar_p('TBH.Helper.BlackYellow'))
    except Exception:
        pass
    # Title-bar icon and brand mark use the same transparent PNG, so the
    # existing light UI layout stays unchanged.
    try:
        from PIL import Image, ImageTk
        self._title_icon_sources = []
        for title_size in (16, 24, 32, 48, 64, 128, 256):
            title_image = Image.open(BUNDLE_DIR / 'app_icon.ico').convert('RGBA')
            title_image = title_image.resize((title_size, title_size), Image.LANCZOS)
            title_photo = ImageTk.PhotoImage(title_image, master=self)
            self._title_icon_sources.append(title_photo)
        if self._title_icon_sources:
            self.iconphoto(True, *self._title_icon_sources)
    except Exception:
        self._title_icon_sources = []
    self._native_brand_icons = []
    def sync_native_brand_icons():
        if getattr(self, 'shutting_down', False):
            return
        try:
            from ctypes import wintypes
            user32 = ctypes.WinDLL('user32', use_last_error=True)
            user32.LoadImageW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR,
                                         wintypes.UINT, ctypes.c_int, ctypes.c_int, wintypes.UINT]
            user32.LoadImageW.restype = wintypes.HANDLE
            user32.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
            user32.GetAncestor.restype = wintypes.HWND
            user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
            user32.SendMessageW.restype = wintypes.LPARAM
            user32.SetClassLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
            user32.SetClassLongPtrW.restype = ctypes.c_size_t
            if not self._native_brand_icons:
                for size in (16, 32):
                    handle = user32.LoadImageW(None, str(BUNDLE_DIR / 'app_icon.ico'), 1, size, size, 0x10)
                    if not handle:
                        raise ctypes.WinError(ctypes.get_last_error())
                    self._native_brand_icons.append(handle)
            hwnd = user32.GetAncestor(self.winfo_id(), 2)
            if hwnd:
                for kind, handle in enumerate(self._native_brand_icons):
                    user32.SendMessageW(hwnd, 0x80, kind, handle)
                user32.SetClassLongPtrW(hwnd, -34, self._native_brand_icons[0])
                user32.SetClassLongPtrW(hwnd, -14, self._native_brand_icons[1])
                if getattr(self, '_native_brand_property_hwnd', None) != hwnd:
                    class Guid(ctypes.Structure):
                        _fields_ = [('a', ctypes.c_uint32), ('b', ctypes.c_uint16),
                                    ('c', ctypes.c_uint16), ('d', ctypes.c_ubyte * 8)]
                    class PropertyKey(ctypes.Structure):
                        _fields_ = [('fmtid', Guid), ('pid', ctypes.c_uint32)]
                    class PropertyValueData(ctypes.Union):
                        _fields_ = [('text', ctypes.c_wchar_p), ('storage', ctypes.c_ubyte * 16)]
                    class PropertyValue(ctypes.Structure):
                        _fields_ = [('vt', ctypes.c_uint16), ('reserved', ctypes.c_uint16 * 3),
                                    ('data', PropertyValueData)]
                    iid = Guid(0x886D8EEB, 0x8CF2, 0x4446,
                               (ctypes.c_ubyte * 8)(0x8D, 0x02, 0xCD, 0xBA, 0x1D, 0xBD, 0xCF, 0x99))
                    fmtid = Guid(0x9F4C2855, 0x9F79, 0x4B39,
                                 (ctypes.c_ubyte * 8)(0xA8, 0xD0, 0xE1, 0xD4, 0x2D, 0xE1, 0xD5, 0xF3))
                    shell32 = ctypes.WinDLL('shell32', use_last_error=True)
                    shell32.SHGetPropertyStoreForWindow.argtypes = [wintypes.HWND, ctypes.POINTER(Guid), ctypes.POINTER(ctypes.c_void_p)]
                    shell32.SHGetPropertyStoreForWindow.restype = ctypes.c_long
                    store = ctypes.c_void_p()
                    result = shell32.SHGetPropertyStoreForWindow(hwnd, ctypes.byref(iid), ctypes.byref(store))
                    if result < 0:
                        raise OSError(f'Windows taskbar property store: {result:#x}')
                    table = ctypes.cast(store, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
                    release = ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(table[2])
                    set_value = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p,
                                                  ctypes.POINTER(PropertyKey), ctypes.POINTER(PropertyValue))(table[6])
                    commit = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p)(table[7])
                    executable = str(APP_DIR / 'TBH助手.exe')
                    icon_resource = executable + ',0'
                    try:
                        # Keep taskbar pinning independent from the extracted bundle path.
                        icon_path = APP_DIR / 'tbh-brand-blackyellow.ico'
                        icon_bytes = (BUNDLE_DIR / 'app_icon.ico').read_bytes()
                        if not icon_path.is_file() or icon_path.read_bytes() != icon_bytes:
                            icon_path.write_bytes(icon_bytes)
                        icon_resource = str(icon_path) + ',0'
                    except OSError:
                        pass
                    try:
                        # Explicit window properties also refresh the taskbar group icon.
                        for prop_id, text in ((2, '"' + executable + '"'), (3, icon_resource),
                                              (4, 'TBH助手'), (5, 'TBH.Helper.BlackYellow')):
                            key = PropertyKey(fmtid, prop_id)
                            value = PropertyValue()
                            value.vt, value.data.text = 31, text
                            result = set_value(store, ctypes.byref(key), ctypes.byref(value))
                            if result < 0:
                                raise OSError(f'Windows taskbar property {prop_id}: {result:#x}')
                        result = commit(store)
                        if result < 0:
                            raise OSError(f'Windows taskbar property commit: {result:#x}')
                        self._native_brand_property_hwnd = hwnd
                    finally:
                        release(store)
        except Exception as exc:
            self.thread_log(f'[图标] Windows 图标同步失败：{exc}')
    self._ui_sync_native_brand_icons = sync_native_brand_icons
    self.after_idle(sync_native_brand_icons)
    self.after(1000, sync_native_brand_icons)
    style = ttk.Style(self)
    self._ui_base_styles = {}
    configure_style = style.configure

    def record_style(name, **options):
        self._ui_base_styles.setdefault(name, {}).update(options)
        return configure_style(name, **options)

    style.configure = record_style
    try:
        style.theme_use('clam')
    except Exception:
        pass
    font = ('Microsoft YaHei UI', 10)
    style.configure('TFrame', background=colors['background'])
    style.configure('Sidebar.TFrame', background=colors['panel'])
    style.configure('Panel.TFrame', background=colors['panel'])
    style.configure('Card.TFrame', background=colors['panel_alt'])
    style.configure('TLabel', background=colors['background'], foreground=colors['text'], font=font)
    style.configure('Panel.TLabel', background=colors['panel'], foreground=colors['text'], font=font)
    style.configure('Muted.TLabel', background=colors['background'], foreground=colors['muted'], font=font)
    style.configure('PanelMuted.TLabel', background=colors['panel'], foreground=colors['muted'], font=('Microsoft YaHei UI', 9))
    style.configure('Eyebrow.TLabel', background=colors['background'], foreground=colors['accent'], font=('Segoe UI', 9, 'bold'))
    style.configure('Hero.TLabel', background=colors['background'], foreground=colors['text'], font=('Microsoft YaHei UI', 22, 'bold'))
    style.configure('PageTitle.TLabel', background=colors['background'], foreground=colors['text'], font=('Microsoft YaHei UI', 21, 'bold'))
    style.configure('PageSubtitle.TLabel', background=colors['background'], foreground=colors['muted'], font=('Microsoft YaHei UI', 9))
    style.configure('Sponsor.TButton', background=colors['background'], foreground='#DC3545', font=('Microsoft YaHei UI', 10), borderwidth=0, padding=(7, 4))
    style.map('Sponsor.TButton', foreground=[('active', '#B91C1C'), ('!disabled', '#DC3545')], background=[('active', colors['panel_alt']), ('!disabled', colors['background'])])
    style.configure('CardTitle.TLabel', background=colors['panel'], foreground=colors['muted'], font=('Microsoft YaHei UI', 9))
    style.configure('CardValue.TLabel', background=colors['panel'], foreground=colors['accent'], font=('Microsoft YaHei UI', 22, 'bold'))
    style.configure('StatusTitle.TLabel', background=colors['panel'], foreground=colors['muted'], font=('Microsoft YaHei UI', 9))
    style.configure('StatusValue.TLabel', background=colors['panel'], foreground=colors['accent'], font=('Microsoft YaHei UI', 11, 'bold'))
    style.configure('ColumnHeader.TLabel', background=colors['panel'], foreground=colors['accent'], font=('Microsoft YaHei UI', 9, 'bold'))
    style.configure('DrawerTitle.TLabel', background=colors['panel'], foreground=colors['text'], font=('Microsoft YaHei UI', 15, 'bold'))
    style.configure('DrawerSubtitle.TLabel', background=colors['panel'], foreground=colors['muted'], font=('Microsoft YaHei UI', 9))
    style.configure('RewardBadge.TLabel', background='#E7F2F5', foreground=colors['accent'], font=('Segoe UI Symbol', 17, 'bold'), padding=(7, 5))
    style.configure('QueueCount.TLabel', background=colors['panel_alt'], foreground=colors['accent'], font=('Microsoft YaHei UI', 15, 'bold'))
    style.configure('QueueNote.TLabel', background=colors['panel_alt'], foreground=colors['muted'], font=('Microsoft YaHei UI', 8))
    style.configure('GroupBadge.TLabel', background=colors['panel_alt'], foreground=colors['accent'], font=('Segoe UI Symbol', 10, 'bold'), padding=(5, 3))
    style.configure('GroupName.TLabel', background=colors['panel'], foreground=colors['text'], font=('Microsoft YaHei UI', 9, 'bold'))
    style.configure('GroupCount.TLabel', background=colors['panel'], foreground=colors['muted'], font=('Microsoft YaHei UI', 8))
    style.configure('MatrixTitle.TLabel', background=colors['panel'], foreground=colors['text'], font=('Segoe UI', 9, 'bold'))
    style.configure('MatrixInfo.TLabel', background=colors['panel'], foreground=colors['muted'], font=('Microsoft YaHei UI', 9))
    style.configure('RewardName.TLabel', background=colors['panel_alt'], foreground=colors['text'], font=('Microsoft YaHei UI', 9, 'bold'))
    style.configure('RewardPrice.TLabel', background=colors['panel_alt'], foreground=colors['muted'], font=('Microsoft YaHei UI', 8))
    style.configure('RewardOrder.TLabel', background=colors['panel_alt'], foreground='#68829F', font=('Consolas', 8))
    style.configure('Pill.TLabel', background='#EAF7F0', foreground='#16834A', font=('Microsoft YaHei UI', 9, 'bold'), padding=(10, 6))
    style.configure('PillMuted.TLabel', background=colors['panel_alt'], foreground=colors['muted'], font=('Microsoft YaHei UI', 9, 'bold'), padding=(10, 6))
    style.configure('Nav.TButton', background=colors['panel'], foreground=colors['muted'], anchor='w', font=font, borderwidth=0, relief='flat', padding=(12, 10))
    style.map('Nav.TButton', background=[('active', '#F1F5F9')], foreground=[('active', colors['text'])])
    style.configure('NavSelected.TButton', background='#EAF3F5', foreground=colors['text'], anchor='w', font=('Microsoft YaHei UI', 10, 'bold'), borderwidth=0, relief='flat', padding=(12, 10))
    style.map('NavSelected.TButton', background=[('active', '#EAF3F5')], foreground=[('active', colors['text'])])
    style.configure('TCheckbutton', background=colors['panel'], foreground=colors['text'], font=font, padding=(2, 4), indicatorcolor=colors['border'])
    style.map('TCheckbutton', background=[('active', colors['panel'])], foreground=[('disabled', colors['disabled'])])
    style.configure('TButton', background=colors['panel_alt'], foreground=colors['text'], font=font, borderwidth=1, bordercolor=colors['border'], relief='flat', padding=(9, 5))
    style.map('TButton', background=[('active', '#EAF0F6'), ('pressed', colors['border'])], foreground=[('disabled', colors['disabled'])])
    style.configure('Utility.TButton', background=colors['panel'], foreground=colors['muted'], font=('Microsoft YaHei UI', 9), borderwidth=1, bordercolor=colors['border'], relief='flat', padding=(7, 4))
    style.map('Utility.TButton', background=[('active', colors['panel_alt']), ('pressed', colors['border'])], foreground=[('disabled', colors['disabled'])])
    style.configure('Accent.TButton', background='#B96B0A', foreground='#FFFFFF', font=('Microsoft YaHei UI', 10, 'bold'), borderwidth=0, padding=(12, 7))
    style.map('Accent.TButton', background=[('active', '#A95E06'), ('pressed', '#A95E06')], foreground=[('disabled', colors['disabled'])])
    style.configure('Danger.TButton', background='#FFF1F2', foreground='#C83B4A', font=('Microsoft YaHei UI', 9, 'bold'), borderwidth=1, bordercolor='#F3CDD2', relief='flat', padding=(8, 5))
    style.map('Danger.TButton', background=[('active', '#FFE6E9')], foreground=[('disabled', colors['disabled'])])
    style.configure('TCombobox', fieldbackground=colors['field'], background=colors['panel_alt'], foreground=colors['text'], arrowcolor=colors['accent'], bordercolor=colors['border'], lightcolor=colors['border'], darkcolor=colors['border'], relief='flat', borderwidth=1, padding=(8, 4), arrowsize=12, font=font)
    style.map('TCombobox', fieldbackground=[('disabled', colors['panel']), ('readonly', colors['field'])], background=[('active', colors['panel_alt']), ('readonly', colors['panel'])], foreground=[('disabled', colors['disabled']), ('readonly', colors['text'])], bordercolor=[('focus', colors['accent']), ('!focus', colors['border'])], arrowcolor=[('disabled', colors['disabled']), ('active', colors['accent_hover']), ('!active', colors['accent'])])
    style.configure('TEntry', fieldbackground=colors['field'], foreground=colors['text'], bordercolor=colors['border'], lightcolor=colors['border'], darkcolor=colors['border'], relief='flat', borderwidth=1, insertcolor=colors['accent'], padding=5, font=font)
    style.map('TEntry', bordercolor=[('focus', colors['accent']), ('!focus', colors['border'])])
    style.configure('Challenge.TEntry', foreground=colors['accent'], font=('Segoe UI', 10, 'bold'), padding=(7, 5))
    style.configure('ChallengeHeading.TLabel', background=colors['background'], foreground=colors['text'], font=('Microsoft YaHei UI', 16, 'bold'))
    style.configure('TSeparator', background=colors['border'])
    style.configure('Treeview', background=colors['field'], fieldbackground=colors['field'], foreground=colors['text'], bordercolor=colors['border'], rowheight=30, font=font)
    style.map('Treeview', background=[('selected', '#DDECF1')], foreground=[])
    style.configure('Treeview.Heading', background=colors['panel_alt'], foreground=colors['text'], font=('Microsoft YaHei UI', 9, 'bold'), padding=(8, 7), relief='flat')
    style.configure('Warehouse.Treeview', background='#FFFFFF', fieldbackground='#FFFFFF', foreground=colors['text'], borderwidth=0, rowheight=34, font=('Microsoft YaHei UI', 10))
    style.map('Warehouse.Treeview', background=[('selected', '#DDECF1')], foreground=[])
    style.configure('Warehouse.Treeview.Heading', background='#EAF3F5', foreground=colors['accent'], font=('Microsoft YaHei UI', 10, 'bold'), padding=(10, 8), relief='flat')
    style.configure('Stats.Treeview', background='#FFFFFF', fieldbackground='#FFFFFF', foreground=colors['text'], borderwidth=0, rowheight=32, font=('Microsoft YaHei UI', 9))
    style.map('Stats.Treeview', background=[('selected', '#DDECF1')], foreground=[])
    style.configure('Stats.Treeview.Heading', background='#EAF3F5', foreground=colors['accent'], font=('Microsoft YaHei UI', 9, 'bold'), padding=(9, 7), relief='flat')
    style.configure('TNotebook', background=colors['background'], borderwidth=0)
    style.configure('TNotebook.Tab', background=colors['panel'], foreground=colors['muted'], font=font, padding=(18, 10))
    style.map('TNotebook.Tab', background=[('selected', colors['panel_alt'])], foreground=[('selected', colors['accent'])])
    for grade in GRADE_COLORS:
        key = grade_style_key(grade)
        color = GRADE_COLORS.get(grade, colors['muted'])
        style.configure(f'RewardName.{key}.TLabel', background=colors['panel_alt'], foreground=color, font=('Microsoft YaHei UI', 9, 'bold'))
        style.configure(f'RewardMeta.{key}.TLabel', background=colors['panel_alt'], foreground=color, font=('Microsoft YaHei UI', 8))
        style.configure(f'RewardIcon.{key}.TLabel', background=GRADE_SLOT_COLORS.get(grade, colors['panel_alt']), foreground=color, font=('Segoe UI Symbol', 13, 'bold'), padding=0)
        style.configure(f'Grade.{key}.TCombobox', foreground=color)
        style.map(f'Grade.{key}.TCombobox', foreground=[('disabled', colors['disabled']), ('readonly', color)])
    style.configure('TLabelframe', background=colors['panel'], bordercolor=colors['border'], relief='solid', borderwidth=1)
    style.configure('TLabelframe.Label', background=colors['panel'], foreground=colors['text'], font=('Microsoft YaHei UI', 10, 'bold'), padding=(4, 0))
    def make_switch_image(track_color, knob_color, knob_x, width=48, height=26):
        from PIL import Image, ImageTk
        supersample = 6
        render_width, render_height = width * supersample, height * supersample
        image = Image.new('RGBA', (render_width, render_height), (0, 0, 0, 0))
        sx, sy = width * supersample / 48, height * supersample / 26
        def rgba(color):
            return tuple(int(color[i:i + 2], 16) for i in (1, 3, 5)) + (255,)
        track, knob = rgba(track_color), rgba(knob_color)
        pixels = [(0, 0, 0, 0)] * (render_width * render_height)
        for y in range(render_height):
            uy = (y + 0.5) / sy - 13
            for x in range(render_width):
                ux = (x + 0.5) / sx
                if (ux - knob_x) ** 2 + uy ** 2 <= 64:
                    pixels[y * render_width + x] = knob
                elif (ux - min(37, max(11, ux))) ** 2 + uy ** 2 <= 100:
                    pixels[y * render_width + x] = track
        image.putdata(pixels)
        image = image.resize((width, height), Image.Resampling.LANCZOS)
        return ImageTk.PhotoImage(image, master=self)

    switch_specs = {
        'off': (colors['border'], colors['text'], 12),
        'on': (colors['accent'], '#FFFFFF', 36),
        'disabled_off': ('#E6EBF0', '#AAB5C2', 12),
        'disabled_on': ('#B8D9DE', '#FFFFFF', 36),
    }

    self._switch_images = {
        key: make_switch_image(*spec) for key, spec in switch_specs.items()
    }
    try:
        style.element_create('Switch.indicator', 'image', self._switch_images['off'],
                             ('disabled', 'selected', self._switch_images['disabled_on']),
                             ('disabled', self._switch_images['disabled_off']),
                             ('selected', self._switch_images['on']), border=0, sticky='w')
    except Exception:
        pass
    def switch_layout_element(element):
        if not isinstance(element, tuple) or len(element) != 2:
            return element
        name, options = element
        if name == 'Checkbutton.indicator':
            name = 'Switch.indicator'
        options = dict(options)
        if 'children' in options:
            options['children'] = [switch_layout_element(child) for child in options['children']]
        return name, options
    try:
        style.layout('TCheckbutton', [switch_layout_element(element) for element in style.layout('TCheckbutton')])
    except Exception:
        pass
    # Populate the existing dashboard scale cache with exact-size antialiased assets.
    self._ui_switch_cache = {}
    for numerator in range(6, 15):
        scaled_images = {key: make_switch_image(*spec, width=round(48 * numerator / 10),
                                               height=round(26 * numerator / 10))
                         for key, spec in switch_specs.items()}
        self._ui_switch_cache[numerator] = scaled_images
        style.element_create(f'ScaledSwitch{numerator}.indicator', 'image', scaled_images['off'],
                             ('disabled', 'selected', scaled_images['disabled_on']),
                             ('disabled', scaled_images['disabled_off']),
                             ('selected', scaled_images['on']), border=0, sticky='w')
    self._tray_switch_images = {key: make_switch_image(*spec, width=34, height=18)
                                for key, spec in switch_specs.items()}
    try:
        style.element_create('TraySwitch.indicator', 'image', self._tray_switch_images['off'],
                             ('disabled', 'selected', self._tray_switch_images['disabled_on']),
                             ('disabled', self._tray_switch_images['disabled_off']),
                             ('selected', self._tray_switch_images['on']), border=0, sticky='w')
        def tray_layout(rows):
            result = []
            for name, settings in rows:
                settings = dict(settings)
                if name == 'Switch.indicator':
                    name = 'TraySwitch.indicator'
                if 'children' in settings:
                    settings['children'] = tray_layout(settings['children'])
                result.append((name, settings))
            return result
        style.layout('Tray.TCheckbutton', tray_layout(style.layout('TCheckbutton')))
    except Exception:
        pass
    style.configure('Tray.TCheckbutton', font=('Microsoft YaHei UI', 9), padding=(0, 2))
    style.configure('TrayTitle.TLabel', background=colors['panel'], foreground=colors['text'], font=('Segoe UI', 10, 'bold'))
    style.configure('Tray.TButton', font=('Microsoft YaHei UI', 9), padding=(5, 3), width=5)
    for scrollbar_style in ('TScrollbar', 'Vertical.TScrollbar', 'Horizontal.TScrollbar'):
        style.configure(scrollbar_style, background=colors['panel_alt'], troughcolor=colors['field'], arrowcolor=colors['accent'], bordercolor=colors['field'], lightcolor=colors['panel_alt'], darkcolor=colors['panel_alt'], relief='flat')
        style.map(scrollbar_style, background=[('active', colors['border'])])
    self.option_add('*Listbox.background', colors['field'])
    self.option_add('*Listbox.foreground', colors['text'])
    self.option_add('*Listbox.selectBackground', '#DDECF1')
    self.option_add('*Listbox.selectForeground', colors['text'])


def _build_ui(self):
    global MARKET_PRICE_MAX_AGE_SECONDS
    # One controller can manage every local/Sandboxie game process. Running
    # multiple controllers against the same PIDs duplicates server actions.
    self._helper_single_instance_primary = True
    self._helper_single_instance_handle = None
    try:
        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
        kernel32.CreateMutexW.restype = ctypes.c_void_p
        kernel32.GetLastError.restype = ctypes.c_ulong
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_bool
        mutex = kernel32.CreateMutexW(None, True, 'Local\\TBHHelper-AutoAttach-Singleton')
        if mutex:
            if kernel32.GetLastError() == 183:
                self._helper_single_instance_primary = False
                kernel32.CloseHandle(ctypes.c_void_p(mutex))
            else:
                self._helper_single_instance_handle = ctypes.c_void_p(mutex)
                self._helper_single_instance_kernel32 = kernel32
    except Exception:
        # If Windows mutex creation is unavailable, retain the existing attach path.
        self._helper_single_instance_primary = True
    MARKET_PRICE_MAX_AGE_SECONDS = 3600
    DEFAULT_CONFIG.update({
        'autoDepositAllItems': True,
        'autoDepositIntervalMinutes': 10,
        'autoBoxCheckIntervalMinutes': 1,
        'boxScanIntervalMs': 60000,
        'boxOpenDelayMs': 1800,
        'autoTradeShipIntervalMinutes': 1,
        'autoTradeShipIntervalMs': 60000,
        'autoTradeShipMinPriceCny': 1.0,
        'autoTradeShipPriceMode': 'range',
        'autoTradeShipMaxPriceCny': 0.0,
        'tradeShipLockedUids': [],
        'tradeShipDeferredItems': [],
        'autoUpdateCheck': True,
        'bossTicketCheckIntervalMinutes': 1,
        'mapSwitchMinimumIntervalSeconds': 10,
        'autoPlagueMapEnabled': False,
        'autoPlagueDifficulty': 3,
        'autoPlagueStageNo': 1,
        'autoPlagueCheckIntervalMinutes': 1,
        'corrosionMinimumIntervalMinutes': 5,
        'corrosionWarehouseThresholdPercent': 50,
        'corrosionPollutionThreshold': 300,
        'corrosionProtectOfferingMaterials': True,
        'corrosionProtectSoulstones': True,
        'corrosionProtectRelics': True,
        'corrosionProtectJackTickets': True,
        'corrosionRelicProtectedGrades': list(range(10)),
    })
    self.cfg = deep_merge(DEFAULT_CONFIG, self.cfg if isinstance(self.cfg, dict) else {})
    def normalize_trade_ship_locked_uids(values):
        if not isinstance(values, (list, tuple, set)):
            return []
        unique = set()
        for value in values:
            uid = str(value or '').strip()
            if uid.isdigit() and uid != '0' and len(uid) <= 20:
                unique.add(uid)
        return sorted(unique, key=lambda value: (len(value), value))
    self.cfg['tradeShipLockedUids'] = normalize_trade_ship_locked_uids(
        self.cfg.get('tradeShipLockedUids'))
    self.cfg.update({
        'autoDepositAllItems': True,
        'extraDepositItemIds': [],
        'instantKill': False,
        'godMode': False,
        'waveLock': False,
        'memoryClean': False,
    })
    self.history_records = [record for record in (getattr(self, 'history_records', []) or [])
                            if isinstance(record, dict) and record.get('kind') in ('box', 'box-loot')]
    self.history_ids = {str(record.get('eventId')) for record in self.history_records if record.get('eventId')}
    colors = UI_COLORS
    self.title('TBH助手')
    self.columnconfigure(0, weight=0, minsize=218)
    self.columnconfigure(1, weight=1)
    self.rowconfigure(0, weight=1)
    self.rowconfigure(1, weight=0)
    self.runtime_controls = []
    self._dashboard_sections = []
    self._warehouse_price_query_enabled = False
    self._warehouse_snapshots = {}
    self._warehouse_refresh_busy = False
    self._warehouse_refresh_queued = False
    self._warehouse_account_pids = {}
    self._warehouse_last_refresh = 0.0
    self._warehouse_icon_cache = {}
    self._warehouse_card_images = []
    self._warehouse_card_rows = []
    self._warehouse_card_hitboxes = []
    self._warehouse_card_draw_after = None
    self._warehouse_card_signature = None
    self._warehouse_card_filter = None
    self._warehouse_card_region = None
    self._warehouse_card_selected = None
    self._warehouse_card_hovered = None
    self._manual_trade_ship_busy = False
    self._corrosion_status_probe_busy = False
    self._corrosion_status_probe_next_at = 0.0

    def render_corrosion_account_rows(values, errors=()):
        tree = getattr(self, 'corrosion_accounts_tree', None)
        if tree is None:
            return
        tree.delete(*tree.get_children())
        by_pid = {int(row['pid']): row for row in values}
        try:
            pids = sorted(set(self.backend.target_pids()) | set(by_pid))
        except Exception:
            pids = sorted(by_pid)
        for pid in pids:
            row = by_pid.get(int(pid))
            try:
                label = self.backend.label_for_pid(pid)
            except Exception:
                label = '游戏进程'
            account = f'{label} · {pid}'
            if not row:
                detail = next((str(error).split(': ', 1)[-1] for error in errors
                    if str(error).startswith(f'{pid}:')), '等待读取')
                tree.insert('', 'end', iid=f'corrosion-{pid}', values=(account, '—', '—', '—',
                    '—', detail[:70], '—'), tags=('error' if detail != '等待读取' else 'waiting',))
                continue
            poll_threshold = row['pollutionThreshold']
            pollution_rule = f'< {poll_threshold:,}' if poll_threshold > 0 else '关闭'
            usage = (f"{row['warehouseUsed']} / {row['warehouseCapacity']} · {row['warehousePercent']:.1f}%"
                if row['inventoryObservedAt'] > 0 else '待采样')
            if not row['autoCorrosion']:
                result, tag = '自动腐蚀未启用', 'waiting'
            elif row['triggered']:
                result, tag = '达到：' + row['triggerReason'], 'triggered'
            else:
                result, tag = '等待触发', 'ready'
            refreshed = datetime.now().strftime('%H:%M:%S')
            tree.insert('', 'end', iid=f'corrosion-{pid}', values=(account,
                f"{row['pollution']:,}" if row['pollution'] >= 0 else '读取失败', pollution_rule,
                usage, f"≥ {row['warehouseThresholdPercent']}%", result, refreshed), tags=(tag,))
        if not pids:
            tree.insert('', 'end', values=('等待游戏连接', '—', '—', '—', '—', '连接后自动读取各账号资源', '—'), tags=('waiting',))
        tree.configure(height=max(2, min(6, len(pids) or 2)))

    def refresh_corrosion_status(force=False):
        if not getattr(self, '_corrosion_status_probe_trace_logged', False):
            self._corrosion_status_probe_trace_logged = True
            try:
                file_log('corrosion-ui', 'probe-entered', {'connected':self.backend.connected(),
                    'enabled':bool(getattr(self, 'auto_corrosion_var', None) and self.auto_corrosion_var.get()),
                    'force':force})
            except Exception:
                pass
        if not hasattr(self, 'corrosion_status_var'):
            return
        now = time.monotonic()
        if not force and now < self._corrosion_status_probe_next_at:
            return
        try:
            if not self.backend.connected():
                self.corrosion_status_var.set('等待连接')
                render_corrosion_account_rows([])
                self._corrosion_status_probe_next_at = now + 2
                return
        except Exception:
            self.corrosion_status_var.set('等待连接')
            self._corrosion_status_probe_next_at = now + 2
            return
        if self._corrosion_status_probe_busy:
            return
        self._corrosion_status_probe_next_at = now + 30
        self._corrosion_status_probe_busy = True

        def worker():
            values = []
            errors = []
            diagnostic_summaries = []
            result_pids = []
            error_pids = []
            try:
                results, rpc_errors = self.backend.rpc_all('getcorrosionpollution')
                result_pids = list(results)
                error_pids = list(rpc_errors)
                errors.extend(f'{pid}: {message}' for pid, message in rpc_errors.items())
                for pid, raw in results.items():
                    try:
                        value = json.loads(raw) if isinstance(raw, str) else raw
                        if isinstance(value, dict) and value.get('status') == 'SUCCESS':
                            values.append({
                                'pid': int(value.get('pid') or pid),
                                'pollution': safe_int(value.get('pollution'), -1),
                                'pollutionThreshold': safe_int(value.get('pollutionThreshold'), 0),
                                'warehouseUsed': safe_int(value.get('warehouseUsed'), 0),
                                'warehouseCapacity': max(1, safe_int(value.get('warehouseCapacity'), 343)),
                                'warehousePercent': float(value.get('warehousePercent') or 0),
                                'warehouseThresholdPercent': safe_int(value.get('warehouseThresholdPercent'), 50),
                                'triggered': value.get('triggered') is True,
                                'triggerReason': str(value.get('triggerReason') or '未达到'),
                                'autoCorrosion': value.get('autoCorrosion') is True,
                                'inventoryObservedAt': safe_int(value.get('inventoryObservedAt'), 0),
                            })
                        else:
                            errors.append(f'{pid}: {value.get("error") or "污染度回包无效"}')
                            diagnostic = value.get('diagnostics') if isinstance(value, dict) else None
                            if diagnostic:
                                classes = diagnostic.get('classes') or []
                                for class_row in classes:
                                    relevant_fields = [field for field in class_row.get('fields') or []
                                        if isinstance(field, dict)]
                                    if relevant_fields and re.search('plague|pollution|corrosion',
                                            str(class_row.get('className') or '') + ' ' +
                                            str(class_row.get('namespace') or ''), re.I):
                                        names = ', '.join(f"{field.get('name')}:{field.get('type')}:{'S' if field.get('isStatic') else 'I'}" for field in relevant_fields[:40])
                                        diagnostic_summaries.append(
                                            f"PID {pid} {class_row.get('namespace')}.{class_row.get('className')} 字段[{names}]")
                    except Exception as exc:
                        errors.append(f'{pid}: {exc}')
            except Exception as exc:
                errors.append(str(exc))
                file_log('corrosion-ui', 'poll-exception', {'error':str(exc)})
            if errors and not diagnostic_summaries:
                try:
                    diagnostics, _diagnostic_errors = self.backend.rpc_all('getcorrosiondiagnostics')
                    for pid, raw in diagnostics.items():
                        result = json.loads(raw) if isinstance(raw, str) else raw
                        classes = result.get('classes') if isinstance(result, dict) else []
                        for class_row in classes or []:
                            static_fields = [field for field in class_row.get('fields') or []
                                if isinstance(field, dict) and field.get('isStatic')]
                            if static_fields:
                                names = ', '.join(f"{field.get('name')}:{field.get('type')}" for field in static_fields[:24])
                                diagnostic_summaries.append(
                                    f"PID {pid} {class_row.get('namespace')}.{class_row.get('className')} 静态字段[{names}]")
                except Exception as exc:
                    diagnostic_summaries.append('污染度结构诊断失败：' + str(exc))
            file_log('corrosion-ui', 'poll-result', {'resultPids':result_pids,
                'errorPids':error_pids, 'values':values, 'errors':errors,
                'diagnostics':diagnostic_summaries})

            def finish():
                self._corrosion_status_probe_busy = False
                render_corrosion_account_rows(values, errors)
                if values:
                    triggered = sum(row['triggered'] and row['autoCorrosion'] for row in values)
                    self.corrosion_status_var.set(
                        f"已读取 {len(values)} 个账号 · {triggered} 个达到条件 · "
                        f"{len(errors)} 个读取异常 · 每个账号独立判断，满足任一条件即可触发")
                elif errors:
                    detail = str(errors[0])[:100]
                    self.corrosion_status_var.set(
                        f'资源读取异常：{detail}；可点击“刷新账号资源”重试')
                    self.thread_log('自动腐蚀污染度读取结果：' + str(errors[0])[:800])
                    if diagnostic_summaries:
                        self.thread_log('自动腐蚀污染度读取诊断：' + '；'.join(diagnostic_summaries)[:3000])
                else:
                    self.corrosion_status_var.set('已连接 · 等待污染度与仓库负载检测')

            try:
                self.after(0, finish)
            except Exception:
                self._corrosion_status_probe_busy = False

        threading.Thread(target=worker, name='读取腐蚀污染度', daemon=True).start()

    def update_summaries():
        enabled = any((bool(getattr(self, name, None).get()) for name in ('main_enabled_var', 'auto_open_boxes_var', 'auto_corrosion_var', 'auto_deposit_unsynthable_var', 'auto_trade_ship_var', 'auto_boss_var', 'auto_halloween_event_var') if getattr(self, name, None) is not None))
        if hasattr(self, 'auto_state_var'):
            self.auto_state_var.set('自动化已运行' if enabled and self.backend.connected() else '自动化已停止')
        if hasattr(self, 'corrosion_summary_var'):
            self.corrosion_summary_var.set('已启用' if self.auto_corrosion_var.get() else '未启用')
        if hasattr(self, 'corrosion_status_var'):
            try:
                connected = self.backend.connected()
            except Exception:
                connected = False
            if not connected:
                self.corrosion_status_var.set('等待连接')
            elif self.corrosion_status_var.get() == '等待连接':
                auto_corrosion_var = getattr(self, 'auto_corrosion_var', None)
                self.corrosion_status_var.set('已连接 · ' + (
                    '自动腐蚀监控中，等待触发条件' if auto_corrosion_var and auto_corrosion_var.get()
                    else '自动腐蚀未启用'))
            refresh_corrosion_status()
        if hasattr(self, 'footer_status_var') and self.backend.connected():
            try:
                self.footer_status_var.set(f'就绪 · 已连接 {self.backend.connection_count()} 个游戏实例')
            except Exception:
                pass

    def refresh_summaries():
        if getattr(self, 'shutting_down', False):
            return
        update_summaries()
        if getattr(self, '_current_ui_page', None) == 'stats':
            refresh_box_counts()
        elif getattr(self, '_current_ui_page', None) == 'warehouse':
            refresh_warehouse_accounts()
            render_warehouse()
            if not self._warehouse_refresh_busy and time.time() - self._warehouse_last_refresh >= 30:
                refresh_warehouse(False)
        try:
            self.after(1800, refresh_summaries)
        except Exception:
            pass

    def select_page(key):
        key = str(key)
        page = getattr(self, '_ui_pages', {}).get(key)
        if page is None:
            return
        previous_key = getattr(self, '_current_ui_page', None)
        if previous_key == key:
            return
        previous_page = self._ui_pages.get(previous_key)
        if previous_page is not None:
            previous_page.grid_remove()
        page.grid()
        self._current_ui_page = key
        title, subtitle = self._ui_page_titles.get(key, (key, ''))
        self.page_title_var.set(title)
        self.page_subtitle_var.set(subtitle)
        for page_key, widgets in self._navigation_buttons.items():
            row, icon, label, marker = widgets
            selected = page_key == key
            row_color = '#EAF3F5' if selected else colors['panel']
            row.configure(background=row_color)
            icon.configure(background=row_color)
            label.configure(background=row_color, foreground=colors['text'] if selected else colors['muted'])
            marker.configure(background=colors['accent'] if selected else row_color)
        if key == 'accounts':
            self.refresh_account_cards()
        elif key == 'magic':
            refresh_corrosion_status()
        elif key == 'stats':
            refresh_box_counts()
        elif key == 'warehouse':
            refresh_warehouse_accounts()
            refresh_warehouse(False)
        elif key == 'overview':
            update_summaries()

    def stop_all():
        feature_config = {
            'mainEnabled': 'main_enabled_var',
            'autoOpenBoxes': 'auto_open_boxes_var',
            'autoCorrosion': 'auto_corrosion_var',
            'autoDepositUnsynthable': 'auto_deposit_unsynthable_var',
            'autoTradeShip': 'auto_trade_ship_var',
            'autoBoss': 'auto_boss_var',
            'autoHalloweenEvent': 'auto_halloween_event_var',
            'autoPlagueMapEnabled': 'auto_plague_map_var',
            'showDropPreview': 'drop_preview_var',
            'plaguePriceScanEnabled': 'plague_price_scan_var',
        }
        previous_settings = {
            key: bool(getattr(self, variable, None).get())
            for key, variable in feature_config.items()
            if getattr(self, variable, None) is not None
        }
        if any(previous_settings.values()):
            self.cfg['lastAutomationSettings'] = previous_settings
        for name in ('main_enabled_var', 'auto_open_boxes_var', 'auto_corrosion_var',
                     'auto_deposit_unsynthable_var', 'auto_trade_ship_var', 'auto_boss_var',
                     'auto_halloween_event_var', 'auto_plague_map_var', 'drop_preview_var', 'plague_price_scan_var',
                     'auto_attach_var', 'auto_restart_game_var', 'auto_start_host_var',
                     'auto_start_sandbox_var'):
            variable = getattr(self, name, None)
            if variable is not None:
                try:
                    variable.set(False)
                except Exception:
                    pass
        try:
            self.save_ui_config()
            if any(previous_settings.values()):
                self.cfg['lastAutomationSettings'] = previous_settings
                save_config(self.cfg)
            self.configure_market_price_service(self.cfg)
        except Exception as exc:
            self.thread_log(f'关闭自动化时保存配置失败：{exc}')
        if self.backend.connected():
            try:
                self.apply_runtime_config()
            except Exception:
                self.stop()
        update_summaries()

    def start_automation():
        if not self.ensure_activated(show_dialog=True):
            return
        if not self.backend.connected() and (self.auto_start_host_var.get() or self.auto_start_sandbox_var.get()):
            self.auto_attach_var.set(True)
            self.begin_auto_start()
            return
        feature_config = {
            'mainEnabled': 'main_enabled_var',
            'autoOpenBoxes': 'auto_open_boxes_var',
            'autoCorrosion': 'auto_corrosion_var',
            'autoDepositUnsynthable': 'auto_deposit_unsynthable_var',
            'autoTradeShip': 'auto_trade_ship_var',
            'autoBoss': 'auto_boss_var',
            'autoHalloweenEvent': 'auto_halloween_event_var',
            'autoPlagueMapEnabled': 'auto_plague_map_var',
            'showDropPreview': 'drop_preview_var',
            'plaguePriceScanEnabled': 'plague_price_scan_var',
        }
        def any_feature_enabled():
            # Preview/price monitoring keep the agent attached but are not
            # automation actions. After “全部关闭”, still restore the previous
            # action switches even if one monitor toggle remains enabled.
            action_keys = ('mainEnabled', 'autoOpenBoxes', 'autoCorrosion',
                           'autoDepositUnsynthable', 'autoTradeShip', 'autoBoss',
                           'autoHalloweenEvent', 'autoPlagueMapEnabled')
            return any(bool(getattr(self, feature_config[key], None).get())
                       for key in action_keys
                       if getattr(self, feature_config[key], None) is not None)
        if not any_feature_enabled():
            saved = self.cfg.get('lastAutomationSettings') or {}
            restored = False
            for config_key, variable_name in feature_config.items():
                variable = getattr(self, variable_name, None)
                if variable is not None and saved.get(config_key) is True:
                    variable.set(True)
                    restored = True
            if not restored:
                # Fresh installs and configurations created before the
                # previous-state snapshot existed use the established safe set.
                for variable_name in ('auto_open_boxes_var', 'auto_corrosion_var', 'auto_deposit_unsynthable_var'):
                    variable = getattr(self, variable_name, None)
                    if variable is not None:
                        variable.set(True)
                        restored = True
                self.thread_log('一键开启：没有可恢复的上次设置，已启用自动开箱、自动腐蚀和自动存仓；门票挑战及地图跳转保持关闭。')
        self.auto_attach_var.set(True)
        try:
            cfg = self.save_ui_config()
        except Exception as exc:
            messagebox.showerror('一键开启失败', str(exc), parent=self)
            return
        if not self.backend.connected():
            self.status_var.set('正在连接游戏并开启自动化')
            self._ui_start_after_attach = True
            try:
                self.attach_async()
            except Exception as exc:
                self._ui_start_after_attach = False
                self.status_var.set('连接游戏失败')
                self.thread_log(f'一键开启：连接游戏失败：{exc}')
                messagebox.showerror('一键开启失败', str(exc), parent=self)
            return
        self._ui_start_after_attach = False
        self.apply_runtime_config()
        self.thread_log('一键开启：已提交当前自动化设置；启用项将由各已连接游戏进程运行。')
        update_summaries()

    def safe_int(value, fallback=0):
        try:
            return int(value)
        except (TypeError, ValueError, OverflowError):
            return fallback

    def normalized_grade(value):
        names = ('普通', '罕见', '稀有', '传说', '不朽', '至宝', '超凡', '天界', '神圣', '宇宙')
        if isinstance(value, (int, float)):
            index = safe_int(value, -1)
            return names[index] if 0 <= index < len(names) else '未知品级'
        text = str(value or '').strip()
        if text.isdigit():
            index = safe_int(text, -1)
            return names[index] if 0 <= index < len(names) else '未知品级'
        aliases = {'COMMON':'普通','UNCOMMON':'罕见','RARE':'稀有',
                   'LEGENDARY': '传说', '传奇': '传说', 'IMMORTAL': '不朽', 'ARCANA': '至宝',
                   'TRANSCENDENT': '超凡', 'CELESTIAL': '天界', 'DIVINE': '神圣',
                   'COSMIC': '宇宙', 'BEYOND': '超凡'}
        return aliases.get(text.upper(), text if text in names else '未知品级')

    def format_event_time(record):
        value = str(record.get('time') or '').strip()
        if value:
            return value.replace('T', ' ')[:19]
        stamp = safe_int(record.get('confirmedAt'), 0)
        if stamp <= 0:
            return '时间未知'
        try:
            return datetime.fromtimestamp(stamp / 1000).astimezone().strftime('%Y-%m-%d %H:%M:%S')
        except Exception:
            return '时间未知'

    def drop_item_catalog(item_id):
        cache = self.__dict__.setdefault('_drop_item_catalog', {})
        if item_id not in cache:
            cache[item_id] = catalog_item_or_family(item_id)
        return cache[item_id]

    def drop_item_details(item):
        if not isinstance(item, dict):
            return None
        count = safe_int(item.get('count'), 1)
        if count <= 0:
            return None
        item_id = safe_int(item.get('itemId') or item.get('itemKey'), 0)
        catalog = drop_item_catalog(item_id)
        raw_grade = item.get('grade')
        if raw_grade is None or raw_grade == '':
            raw_grade = item.get('gradeValue')
        grade = normalized_grade(raw_grade)
        if grade == '未知品级':
            grade = normalized_grade(catalog.get('gradeZh') or catalog.get('grade'))
        name = str(item.get('name') or catalog.get('zh') or
                   (f'物品编号 {item_id}' if item_id else '未知物品'))
        return item_id, grade, name, count

    def is_drop_soulstone(item_id, name):
        if item_id in (190001, 190002, 190003, 190004, 190102, 190103, 190104):
            return True
        catalog = drop_item_catalog(item_id)
        return ('灵魂石' in name or '灵魂石' in str(catalog.get('zh') or '') or
                'soulstone' in str(catalog.get('en') or '').lower())

    def drop_record_key(record):
        event_id = str(record.get('eventId') or '').strip()
        if event_id:
            return event_id
        from hashlib import sha256
        return 'legacy-' + sha256(json.dumps(record, ensure_ascii=False,
            sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()

    def make_rare_drop_record(record):
        if not isinstance(record, dict) or record.get('kind') != 'box-loot':
            return None
        produced = []
        for item in record.get('produced') or []:
            detail = drop_item_details(item)
            if detail is None or detail[1] not in ('超凡', '天界', '神圣', '宇宙'):
                continue
            item_id, grade, name, count = detail
            produced.append({'itemId': item_id, 'grade': grade, 'name': name, 'count': count})
        if not produced:
            return None
        source_id = drop_record_key(record)
        return {'eventId': source_id + ':rare', 'sourceEventId': source_id,
                'kind': 'rare-loot', 'confirmedAt': safe_int(record.get('confirmedAt'), 0),
                'time': str(record.get('time') or ''), 'pid': safe_int(record.get('pid'), 0),
                'mapName': str(record.get('mapName') or ''), 'produced': produced}

    def sync_rare_drop_records(records):
        path = HISTORY_PATH.with_name('auto_synthesis_rare_drops.jsonl')
        if not hasattr(self, 'rare_drop_records'):
            self.rare_drop_records = []
            self._rare_drop_ids = set()
            self._rare_drop_sources = set()
            self._rare_drop_pending = {}
            self._rare_drop_retry_after = 0.0
            try:
                with path.open('r', encoding='utf-8') as stream:
                    for line in stream:
                        try:
                            record = json.loads(line)
                        except (ValueError, TypeError):
                            continue
                        if not isinstance(record, dict) or record.get('kind') != 'rare-loot':
                            continue
                        event_id = str(record.get('eventId') or '')
                        if not event_id or event_id in self._rare_drop_ids:
                            continue
                        self.rare_drop_records.append(record)
                        self._rare_drop_ids.add(event_id)
                        self._rare_drop_sources.add(str(record.get('sourceEventId') or ''))
            except FileNotFoundError:
                pass
            except (OSError, UnicodeError) as exc:
                self.thread_log(f'[记录] 珍品记录读取失败：{exc}')
        for source in records or []:
            if not isinstance(source, dict) or source.get('kind') != 'box-loot':
                continue
            source_id = drop_record_key(source)
            if source_id in self._rare_drop_sources:
                continue
            self._rare_drop_sources.add(source_id)
            record = make_rare_drop_record(source)
            if record is None or record['eventId'] in self._rare_drop_ids:
                continue
            event_id = record['eventId']
            self.rare_drop_records.append(record)
            self._rare_drop_ids.add(event_id)
            self._rare_drop_pending[event_id] = record
        if self._rare_drop_pending and time.monotonic() >= self._rare_drop_retry_after:
            try:
                with path.open('a', encoding='utf-8') as stream:
                    # A leading newline also separates any interrupted final JSON line.
                    stream.write('\n' + '\n'.join(json.dumps(record, ensure_ascii=False,
                        separators=(',', ':')) for record in self._rare_drop_pending.values()) + '\n')
                self._rare_drop_pending.clear()
            except OSError as exc:
                self._rare_drop_retry_after = time.monotonic() + 30
                self.thread_log(f'[记录] 珍品记录保存失败，30秒后重试：{exc}')
        return self.rare_drop_records

    def collect_drop_statistics(records, record_kind='box-loot'):
        grades = ('普通','罕见','稀有','传说','不朽','至宝','超凡','天界','神圣','宇宙')
        counts = {grade:0 for grade in grades}
        grouped, seen = {}, set()
        excluded = 0
        for record in records or []:
            if not isinstance(record,dict) or record.get('kind') != record_kind:
                continue
            event_id = str(record.get('eventId') or '').strip()
            if event_id:
                if event_id in seen:
                    continue
                seen.add(event_id)
            for item in record.get('produced') or []:
                detail = drop_item_details(item)
                if detail is None:
                    continue
                item_id, grade, name, count = detail
                if grade not in counts:
                    excluded += count
                    continue
                if record_kind == 'rare-loot' and grade not in ('超凡', '天界', '神圣', '宇宙'):
                    continue
                key = (item_id,grade,name)
                row = grouped.setdefault(key,{'count':0,'probabilityCount':0,'map':'','time':0})
                row['count'] += count
                stamp = safe_int(record.get('confirmedAt'),0)
                if stamp >= row['time']:
                    row['time'],row['map'] = stamp,str(record.get('mapName') or '')
                if not is_drop_soulstone(item_id, name):
                    counts[grade] += count
                    row['probabilityCount'] += count
        return grouped,counts,excluded

    def render_drop_table(tree, rows):
        signature = tuple(rows)
        if getattr(tree, '_drop_rows_signature', None) == signature:
            return
        position = tree.yview()[0] if hasattr(tree, 'yview') else 0
        children = tree.get_children()
        if children:
            tree.delete(*children)
        for values, grade in rows:
            tree.insert('', 'end', values=values, tags=(f'drop_grade_{grade}',))
        if hasattr(tree, 'yview_moveto'):
            tree.yview_moveto(position)
        tree._drop_rows_signature = signature

    def drop_row_time(row):
        try:
            return datetime.fromtimestamp(row['time'] / 1000).astimezone().strftime('%Y-%m-%d %H:%M:%S') if row['time'] else '时间未知'
        except (OSError, ValueError, OverflowError):
            return '时间未知'

    def refresh_box_counts(force=False):
        now_ms = int(time.time() * 1000)
        records = getattr(self, 'history_records', ())
        if records is None:
            records = ()
        token = (id(records), len(records), str(records[-1].get('eventId') or '') if records else '', now_ms // 60000)
        retry_due = bool(getattr(self, '_rare_drop_pending', {})) and time.monotonic() >= getattr(self, '_rare_drop_retry_after', 0)
        if not force and getattr(self, '_stats_render_token', None) == token and not retry_due:
            return
        self._stats_render_token = token
        day_ago_ms = now_ms - 24 * 60 * 60 * 1000
        total = 0
        recent = 0
        for record in getattr(self, 'history_records', []) or []:
            if not isinstance(record, dict) or record.get('kind') != 'box':
                continue
            quantity = max(1, min(999999, safe_int(record.get('consumedCount'), 1)))
            stamp = safe_int(record.get('confirmedAt'), 0)
            total += quantity
            if day_ago_ms <= stamp <= now_ms:
                recent += quantity
        values = getattr(self, 'stat_value_vars', {})
        if '24小时宝箱' in values:
            values['24小时宝箱'].set(str(recent))
        if '累计宝箱' in values:
            values['累计宝箱'].set(str(total))
        grade_rank = {name: index for index, name in enumerate(GRADE_NAMES_BY_NUMBER.values())}
        if '传奇' in grade_rank:
            grade_rank['传说'] = grade_rank['传奇']
        tree = getattr(self, 'drop_records_tree', None)
        if tree is not None:
            grouped,grade_counts,excluded = collect_drop_statistics(getattr(self,'history_records',[]))
            drop_total = sum(grade_counts.values())
            recorded_total = sum(row['count'] for row in grouped.values())
            soulstone_total = recorded_total - drop_total
            summary = getattr(self,'drop_grade_tree',None)
            if summary is not None:
                for grade,count in grade_counts.items():
                    values = (grade,count,f'{count*100/drop_total:.2f}%' if drop_total else '0.00%')
                    iid = 'quality_' + str(list(grade_counts).index(grade))
                    if summary.exists(iid):
                        if tuple(str(value) for value in summary.item(iid,'values')) != tuple(str(value) for value in values):
                            summary.item(iid,values=values)
                    else:
                        summary.insert('','end',iid=iid,values=values,tags=(f'drop_grade_{grade}',))
                    color = GRADE_COLORS.get('传奇' if grade=='传说' else grade,colors['muted'])
                    if not getattr(summary, '_stats_grade_tags_set', False):
                        summary.tag_configure(f'drop_grade_{grade}',foreground=color)
                summary._stats_grade_tags_set = True
                self.drop_grade_status_var.set(f'有效掉落总数：{drop_total:,} 件 · 已跳过灵魂石 {soulstone_total:,} 件'
                    + (f' · 未识别品质 {excluded:,} 件不计入' if excluded else ''))
            ordered = sorted(grouped.items(), key=lambda entry: (
                -grade_rank.get(entry[0][1], -1), -entry[1]['count'], entry[0][2].lower()))
            drop_rows = []
            for (item_id, grade, name), row in ordered:
                drop_rows.append(((grade, name, row['count'],
                    row['map'] or '未知地图', drop_row_time(row)), grade))
            render_drop_table(tree, drop_rows)
            color_map = dict(GRADE_COLORS)
            color_map['传说'] = GRADE_COLORS.get('传奇', '#B87230')
            if not getattr(tree, '_stats_grade_tags_set', False):
                for grade, color in color_map.items():
                    tree.tag_configure(f'drop_grade_{grade}', foreground=color)
                tree._stats_grade_tags_set = True
            status = getattr(self, 'drop_records_status_var', None)
            if status is not None:
                status.set(f'已记录 {recorded_total:,} 件掉落 · {len(grouped)} 种物品 · 相同物品叠加数量，显示最近掉落地图与时间')
        rare_tree = getattr(self, 'rare_drop_tree', None)
        if rare_tree is not None:
            rare_records = sync_rare_drop_records(getattr(self, 'history_records', []))
            grouped, _, _ = collect_drop_statistics(rare_records, 'rare-loot')
            ordered = sorted(grouped.items(), key=lambda entry: (
                -entry[1]['time'], -grade_rank.get(entry[0][1], -1), entry[0][2].lower()))
            render_drop_table(rare_tree, [((grade, name, row['count'], row['map'] or '未知地图',
                drop_row_time(row)), grade) for (_, grade, name), row in ordered])
            pending = len(self._rare_drop_pending)
            self.rare_drop_status_var.set(
                f'珍品累计 {sum(row["count"] for row in grouped.values()):,} 件 · {len(grouped)} 种物品 · '
                + (f'{pending} 条待保存，自动重试中' if pending else '已保存至本地，按最近掉落时间排序'))

    def request_statistics_refresh():
        if getattr(self, 'shutting_down', False) or getattr(self, '_stats_refresh_after', None) is not None:
            return
        def finish():
            self._stats_refresh_after = None
            if not getattr(self, 'shutting_down', False):
                refresh_box_counts()
        self._stats_refresh_after = self.after(200, finish)

    def add_box_count_record(pid, payload):
        if not isinstance(payload, dict) or payload.get('success') is not True:
            return
        confirmed_at = safe_int(payload.get('confirmedAt'), int(time.time() * 1000))
        event_type = str(payload.get('type') or '')
        event_id = str(payload.get('eventId') or f'{pid}-{event_type}-{confirmed_at}')
        if event_type not in ('auto_box_open_result', 'auto_box_loot_observed'):
            return
        produced = normalized_obtained_items(payload.get('produced'))

        def append_record(record):
            record_id = str(record.get('eventId') or '')
            if not record_id or record_id in self.history_ids:
                return False
            try:
                with HISTORY_PATH.open('a', encoding='utf-8') as stream:
                    stream.write(json.dumps(record, ensure_ascii=False, separators=(',', ':')) + '\n')
            except OSError as exc:
                self.thread_log(f'[记录] 掉落统计保存失败：{exc}')
            self.history_records.append(record)
            self.history_ids.add(record_id)
            return True

        if event_type == 'auto_box_open_result':
            if event_id not in self.history_ids:
                box_record = {
                    'eventId': event_id,
                    'kind': 'box',
                    'confirmedAt': confirmed_at,
                    'time': datetime.fromtimestamp(confirmed_at / 1000).astimezone().isoformat(timespec='seconds'),
                    'pid': safe_int(pid, 0),
                    'boxType': safe_int(payload.get('boxType'), -1),
                    'boxTypeName': str(payload.get('boxTypeName') or '未知宝箱'),
                    'mapName': str(payload.get('mapName') or ''),
                    'consumedCount': max(1, min(999999, safe_int(payload.get('consumedCount'), 1))),
                    'produced': [],
                }
                append_record(box_record)
            if produced:
                loot_event_id = event_id + ':drops'
                existing = next((row for row in self.history_records if row.get('eventId') == event_id), None)
                if existing is not None:
                    existing['produced'] = produced
                    existing['mapName'] = str(payload.get('mapName') or existing.get('mapName') or '')
                loot_record = {
                    'eventId': loot_event_id, 'parentEventId': event_id, 'kind': 'box-loot',
                    'confirmedAt': confirmed_at,
                    'time': datetime.fromtimestamp(confirmed_at / 1000).astimezone().isoformat(timespec='seconds'),
                    'pid': safe_int(pid, 0), 'boxType': safe_int(payload.get('boxType'), -1),
                    'boxTypeName': str(payload.get('boxTypeName') or '未知宝箱'),
                    'mapName': str(payload.get('mapName') or ''), 'produced': produced,
                }
                append_record(loot_record)
        else:
            loot_record = {
                'eventId': event_id, 'kind': 'box-loot', 'confirmedAt': confirmed_at,
                'time': datetime.fromtimestamp(confirmed_at / 1000).astimezone().isoformat(timespec='seconds'),
                'pid': safe_int(pid, 0), 'boxType': safe_int(payload.get('boxType'), -1),
                'boxTypeName': str(payload.get('boxTypeName') or '游戏自动开箱'),
                'mapName': str(payload.get('mapName') or ''), 'produced': produced,
            }
            append_record(loot_record)
        request_statistics_refresh()

    def warehouse_account_options():
        try:
            targets = self.backend.target_snapshot()
        except Exception:
            targets = []
        options = {'全部账号': None}
        for target in targets or []:
            pid = safe_int(target.get('pid'), 0)
            if pid <= 0:
                continue
            label = str(target.get('label') or ('游戏实例 ' + str(pid)))
            options[f'{label} · PID {pid}'] = pid
        return options

    def refresh_warehouse_accounts():
        combo = getattr(self, 'warehouse_account_combo', None)
        if combo is None:
            return
        options = warehouse_account_options()
        selected = str(self.warehouse_account_var.get() or '全部账号')
        values = list(options)
        self._warehouse_account_pids = options
        if tuple(combo['values']) == tuple(values):
            return
        combo.configure(values=values)
        self.warehouse_account_var.set(selected if selected in options else '全部账号')

    def warehouse_price_text(item_id):
        try:
            prices = self.market_price_service.prices_for([str(item_id)])
            quote = prices.get(str(item_id)) or {}
            price = parse_market_price(quote.get('priceCny'))
            if quote.get('resolved') and price is not None:
                return f'¥{price:.2f}' if price > 0 else '暂无报价'
            error = str(quote.get('error') or '')
            if '429' in error:
                return 'Steam 限流，稍后重试'
            if error:
                return '报价失败，稍后重试'
            return '查询中…' if getattr(self.market_price_service, 'enabled', False) else '未查询'
        except Exception:
            return '暂无报价'

    def warehouse_item_photo(item_id, size):
        from PIL import Image, ImageTk
        # The bundle is the offline cache: exact item ID -> game sprite -> transparent PNG.
        sprite_key = str(item_icon_sprite_key(item_id) or '')
        if not sprite_key or any(char in sprite_key for char in ('/', '\\', ':')):
            return None
        cache = self._warehouse_icon_cache
        key = (sprite_key, size)
        if key in cache:
            return cache[key]
        path = ITEM_ICON_DIR / (sprite_key + '.png')
        try:
            with Image.open(path) as original:
                picture = original.convert('RGBA')
            ratio = min(size / picture.width, size / picture.height)
            dimensions = (max(1, round(picture.width * ratio)), max(1, round(picture.height * ratio)))
            picture = picture.resize(dimensions, Image.Resampling.NEAREST)
            photo = ImageTk.PhotoImage(picture, master=self)
        except (OSError, ValueError, tk.TclError):
            photo = None
        # Visible images also have their own references while old scale sizes expire.
        if len(cache) >= 768:
            cache.pop(next(iter(cache)))
        cache[key] = photo
        return photo

    def warehouse_card_metrics(width, scale):
        scale = max(0.6, min(1.4, float(scale)))
        gap = max(6, round(9 * scale))
        card_width, card_height = max(82, round(110 * scale)), max(106, round(168 * scale))
        columns = max(1, (max(1, int(width)) - gap) // (card_width + gap))
        return columns, card_width, card_height, gap

    def warehouse_visible_range(total, columns, card_height, gap, top, height):
        stride = card_height + gap
        first = max(0, int(top // stride) - 1) * columns
        last = min(total, (max(0, int((top + height) // stride)) + 2) * columns)
        return first, last

    def draw_warehouse_cards():
        self._warehouse_card_draw_after = None
        canvas = getattr(self, 'warehouse_canvas', None)
        if canvas is None or not canvas.winfo_exists() or getattr(self, 'shutting_down', False):
            return
        rows = self._warehouse_card_rows
        scale = max(0.6, min(1.4, float(getattr(self, '_ui_scale', 1.0))))
        width, height = max(1, canvas.winfo_width()), max(1, canvas.winfo_height())
        columns, card_width, card_height, gap = warehouse_card_metrics(width, scale)
        grid_height = max(height, ((len(rows) + columns - 1) // columns) * (card_height + gap) + gap)
        region = (0, 0, width, grid_height)
        if self._warehouse_card_region != region:
            self._warehouse_card_region = region
            canvas.configure(scrollregion=region)
        canvas.delete('item-card')
        self._warehouse_card_hovered = None
        self._warehouse_card_images = []
        self._warehouse_card_hitboxes = []
        if not rows:
            canvas.create_text(width / 2, min(height / 2, 100), text='当前筛选下没有仓库物品',
                fill=colors['muted'], font=('Microsoft YaHei UI', 10), tags=('item-card',))
            return
        top = canvas.canvasy(0)
        first, last = warehouse_visible_range(len(rows), columns, card_height, gap, top, height)
        icon_size = max(32, round(48 * scale))
        text_size = max(8, round(9 * scale))
        quantity_size = max(8, round(8 * scale))
        for index in range(first, last):
            row = rows[index]
            x, y = gap + (index % columns) * (card_width + gap), gap + (index // columns) * (card_height + gap)
            right, bottom = x + card_width, y + card_height
            grade_color = GRADE_COLORS.get('传奇' if row['grade'] == '传说' else row['grade'], colors['muted'])
            border = '#' + ''.join(f'{round(int(grade_color[i:i+2], 16) * .72 + 255 * .28):02x}' for i in (1, 3, 5))
            selected = self._warehouse_card_selected == (row['itemId'], row['grade'],row.get('deferredUntil',0))
            radius = max(4, round(5 * scale))
            shape = canvas.create_polygon(x+radius,y, right-radius,y, right,y,right,y+radius,
                right,bottom-radius,right,bottom, right-radius,bottom,x+radius,bottom,
                x,bottom,x,bottom-radius,x,y+radius,x,y, smooth=True, splinesteps=16,
                fill='#FFFFFF', outline=colors['accent'] if selected else border,
                width=2 if selected else 1, tags=('item-card',))
            center = x + card_width / 2
            price_label = row['priceText']
            if price_label.startswith('Steam 限流'):
                price_label = '报价限流'
            elif price_label.startswith('报价失败'):
                price_label = '报价失败'
            canvas.create_text(center, y + round(13*scale), text=price_label,
                fill=colors['accent'] if row['priceValue'] is not None else colors['muted'],
                font=('Microsoft YaHei UI', text_size, 'bold'), tags=('item-card',))
            photo = warehouse_item_photo(row['itemId'], icon_size)
            if photo is not None:
                self._warehouse_card_images.append(photo)
                canvas.create_image(center, y + round(50*scale), image=photo, tags=('item-card',))
            else:
                canvas.create_text(center, y + round(50*scale), text='◇', fill='#A4B4C5',
                    font=('Segoe UI Symbol', max(20, round(28*scale))), tags=('item-card',))
            canvas.create_text(x+round(7*scale), y+round(83*scale), text='×' + str(row['quantity']),
                anchor='w', fill=colors['text'], font=('Segoe UI', quantity_size, 'bold'), tags=('item-card',))
            if row.get('deferredQuantity',0):
                canvas.create_text(right-round(6*scale),y+round(83*scale),
                    text='禁售×'+str(row['deferredQuantity']),anchor='e',fill='#AA413C',
                    font=('Microsoft YaHei UI',max(7,round(7*scale))),tags=('item-card',))
            name_item = canvas.create_text(center, y+round(105*scale), text=row['name'], width=card_width-round(12*scale),
                justify='center', fill=grade_color, font=('Microsoft YaHei UI', text_size), tags=('item-card',))
            short_name = row['name']
            while len(short_name) > 1:
                bounds = canvas.bbox(name_item)
                if not bounds or bounds[3] - bounds[1] <= round(34 * scale):
                    break
                short_name = short_name[:-1]
                canvas.itemconfigure(name_item, text=short_name + '…')
            if row.get('deferredUntil',0):
                deadline = warehouse_unlock_text(row['deferredUntil'])
                canvas.create_text(center,y+round(145*scale),text='解禁 '+deadline[:10]+'\n'+deadline[11:16]+' 北京时间',
                    fill='#AA413C',justify='center',font=('Microsoft YaHei UI',max(7,round(8*scale))),
                    tags=('item-card',))
            self._warehouse_card_hitboxes.append((x, y, right, bottom, row, shape, border))

    def schedule_warehouse_card_draw(_event=None):
        if self._warehouse_card_draw_after is None and not getattr(self, 'shutting_down', False):
            self._warehouse_card_draw_after = self.after(40, draw_warehouse_cards)

    def warehouse_card_at(event):
        canvas = self.warehouse_canvas
        x, y = canvas.canvasx(event.x), canvas.canvasy(event.y)
        return next((box for box in self._warehouse_card_hitboxes if box[0] <= x <= box[2] and box[1] <= y <= box[3]), None)

    def warehouse_card_hover(event):
        box = warehouse_card_at(event)
        canvas = self.warehouse_canvas
        previous = self._warehouse_card_hovered
        if previous and (not box or previous[5] != box[5]):
            canvas.itemconfigure(previous[5], fill='#FFFFFF')
        self._warehouse_card_hovered = box
        if box:
            row = box[4]
            canvas.itemconfigure(box[5], fill='#F3F8FA')
            restriction_note=''
            if row.get('deferredUntil',0)>int(time.time()*1000):
                local_time=warehouse_unlock_text(row['deferredUntil'])+' 北京时间'
                restriction_note=f' · 限时禁售 {row["deferredQuantity"]} 件，最晚解禁：{local_time}'
            self.warehouse_detail_var.set(f'{row["name"]} · {row["grade"]} · 数量 {row["quantity"]} · {row["priceText"]}'+restriction_note)
        else:
            self.warehouse_detail_var.set('悬停查看完整名称、品质、数量与当前缓存报价')

    def warehouse_card_leave(_event=None):
        previous = self._warehouse_card_hovered
        if previous:
            self.warehouse_canvas.itemconfigure(previous[5], fill='#FFFFFF')
        self._warehouse_card_hovered = None
        self.warehouse_detail_var.set('悬停查看完整名称、品质、数量与当前缓存报价')

    def warehouse_card_click(event):
        box = warehouse_card_at(event)
        if box:
            row = box[4]
            self._warehouse_card_selected = (row['itemId'], row['grade'],row.get('deferredUntil',0))
            self.warehouse_canvas.focus_set()
            schedule_warehouse_card_draw()

    def warehouse_card_scroll(event):
        canvas = self.warehouse_canvas
        if canvas.yview() != (0.0, 1.0):
            canvas.yview_scroll(-int(event.delta / 120) if abs(event.delta) >= 120 else (-1 if event.delta > 0 else 1), 'units')
            schedule_warehouse_card_draw()
            return 'break'

    def warehouse_unlock_text(stamp):
        from datetime import timezone, timedelta
        return datetime.fromtimestamp(stamp/1000,timezone(timedelta(hours=8))).strftime('%Y-%m-%d %H:%M')

    def render_warehouse():
        canvas = getattr(self, 'warehouse_canvas', None)
        if canvas is None:
            return
        grouped = {}
        snapshots = getattr(self, '_warehouse_snapshots', {}) or {}
        try:
            live_pids={int(pid) for pid in self.backend.target_pids()}
        except (AttributeError,TypeError,ValueError):
            live_pids=None
        if live_pids is not None:
            snapshots={pid:snapshot for pid,snapshot in snapshots.items() if int(pid) in live_pids}
            self._warehouse_snapshots=snapshots
        selected = str(getattr(self, 'warehouse_account_var', tk.StringVar(value='全部账号')).get())
        selected_pid = getattr(self, '_warehouse_account_pids', {}).get(selected)
        now_ms=int(time.time()*1000)
        deferred_records=(getattr(self,'cfg',{}) or {}).get('tradeShipDeferredItems') or []
        deferred_index={(str(row.get('accountKey')),str(row.get('uid'))):safe_int(row.get('availableAt'),0)
            for row in deferred_records if isinstance(row,dict) and safe_int(row.get('availableAt'),0)>now_ms}
        hidden_count = 0
        for pid, snapshot in snapshots.items():
            if selected_pid is not None and int(pid) != int(selected_pid):
                continue
            for raw in (snapshot.get('items') if isinstance(snapshot, dict) else []) or []:
                if not isinstance(raw, dict):
                    continue
                item_id = safe_int(raw.get('item_key') or raw.get('itemKey') or raw.get('itemId'), 0)
                if item_id <= 0:
                    continue
                grade_value = safe_int(raw.get('grade'), -1)
                grade = normalized_grade(grade_value)
                source = str(raw.get('source') or '')
                quantity = max(1, safe_int(raw.get('quantity'), 1))
                is_stash = source in ('仓库', '材料仓库')
                if not is_stash:
                    continue
                catalog = catalog_item_or_family(item_id)
                # Static trade eligibility is independent of a temporary server restriction.
                if catalog.get('tradable') is False or raw.get('tradable') is False:
                    hidden_count += quantity
                    continue
                account_key=str(snapshot.get('account_key') or 'process:'+str(pid))
                until=max(safe_int(raw.get('trade_ship_deferred_until'),0),
                    deferred_index.get((account_key,str(raw.get('uid') or '')),0))
                until=until if until>now_ms else 0
                # Different unlock times get separate cards so available copies stay distinct.
                key = (item_id, grade_value,until)
                row = grouped.setdefault(key, {'itemId': item_id, 'grade': grade,
                    'quantity': 0, 'type': str(raw.get('type') or ''), 'name': '',
                    'deferredQuantity':0,'deferredUntil':0})
                row['quantity'] += quantity
                if until>now_ms:
                    row['deferredQuantity']+=quantity
                    row['deferredUntil']=max(row['deferredUntil'],until)
                if not row['type']:
                    row['type'] = str(raw.get('type') or '')
                row['name'] = str(catalog.get('zh') or catalog.get('en') or '未知物品')
        query = str(self.warehouse_search_var.get() or '').strip().lower()
        grade_filter = str(self.warehouse_grade_var.get() or '全部品质')
        type_filter = str(self.warehouse_type_var.get() or '全部类型')
        rows = list(grouped.values())
        rows = [row for row in rows if (not query or query in row['name'].lower() or query in str(row['itemId']))]
        rows = [row for row in rows if grade_filter == '全部品质' or row['grade'] == grade_filter]
        if type_filter == '装备':
            rows = [row for row in rows if row['type'] in ('装备', '首饰', 'GEAR', 'EQUIP', 'equipment', 'accessory')]
        elif type_filter == '材料':
            rows = [row for row in rows if row['type'] in ('材料', 'MATERIAL', 'material', 'RELIC', 'RELIQUARY')]
        price_map = self.market_price_service.prices_for([str(row['itemId']) for row in rows]) if rows else {}
        order = str(self.warehouse_order_var.get() or '品质降序')
        if order == '价格降序':
            rows.sort(key=lambda row: (parse_market_price((price_map.get(str(row['itemId'])) or {}).get('priceCny')) or -1, row['grade'], row['name']), reverse=True)
        elif order == '数量降序':
            rows.sort(key=lambda row: (row['quantity'], row['grade'], row['name']), reverse=True)
        elif order == '名称':
            rows.sort(key=lambda row: row['name'].lower())
        else:
            rows.sort(key=lambda row: (row['grade'] not in GRADE_NAMES_BY_NUMBER.values(), list(GRADE_NAMES_BY_NUMBER.values()).index(row['grade']) if row['grade'] in GRADE_NAMES_BY_NUMBER.values() else -1, row['name']), reverse=True)
        limited_quotes = 0
        failed_quotes = 0
        for row in rows:
            quote = price_map.get(str(row['itemId'])) or {}
            price = parse_market_price(quote.get('priceCny'))
            if quote.get('resolved') and price is not None and price > 0:
                price_text = f'¥{price:.2f}'
            elif quote.get('resolved'):
                price_text = '暂无报价'
            elif '429' in str(quote.get('error') or ''):
                price_text = 'Steam 限流，稍后重试'
                limited_quotes += 1
            elif quote.get('error'):
                price_text = '报价失败，稍后重试'
                failed_quotes += 1
            else:
                price_text = '查询中…'
            row['priceText'] = price_text
            row['priceValue'] = price if quote.get('resolved') and price is not None and price > 0 else None
        signature = tuple((row['itemId'], row['grade'], row['quantity'], row['name'], row['priceText'],
            row['deferredQuantity'],row['deferredUntil']) for row in rows)
        if signature != self._warehouse_card_signature:
            # Preserve scroll position for quote/count refreshes; reset for a different filter/result order.
            filter_key = (selected, query, grade_filter, type_filter, order)
            if filter_key != self._warehouse_card_filter:
                canvas.yview_moveto(0)
            self._warehouse_card_filter = filter_key
            self._warehouse_card_signature = signature
            self._warehouse_card_rows = rows
            self._warehouse_card_hovered = None
            schedule_warehouse_card_draw()
        if hasattr(self, 'warehouse_status_var'):
            quote_note = f' · Steam 限流 {limited_quotes} 项' if limited_quotes else (f' · 报价失败 {failed_quotes} 项' if failed_quotes else '')
            deferred_count = sum(row['deferredQuantity'] for row in rows)
            self.warehouse_status_var.set(f'已显示 {len(rows)} 张卡片 · 限时禁售 {deferred_count} 件 · 已隐藏不可交易 {hidden_count} 件 · 报价共用缓存{quote_note}')

    def refresh_warehouse(force_prices=False):
        if not hasattr(self, 'warehouse_canvas'):
            return
        self._warehouse_price_query_enabled = True
        refresh_warehouse_accounts()
        if self._warehouse_refresh_busy:
            self._warehouse_refresh_queued = True
            return
        options = warehouse_account_options()
        self._warehouse_account_pids = options
        selected = str(self.warehouse_account_var.get() or '全部账号')
        selected_pid = options.get(selected)
        pids = [int(selected_pid)] if selected_pid is not None else sorted(self.backend.target_pids())
        if not pids:
            self.warehouse_status_var.set('等待游戏实例连接')
            render_warehouse()
            return
        self._warehouse_refresh_busy = True
        self.warehouse_status_var.set('正在读取所选账号仓库…')
        def worker():
            snapshots = {}
            errors = {}
            try:
                results, rpc_errors = self.backend.rpc_all('getinventoryrows', pids=pids)
                errors.update(rpc_errors)
                for pid, result in results.items():
                    try:
                        value = json.loads(result) if isinstance(result, str) else result
                        if not isinstance(value, dict) or value.get('status') != 'SUCCESS':
                            raise ValueError(str(value.get('message') if isinstance(value, dict) else '仓库回包格式无效'))
                        value['label'] = self.backend.label_for_pid(pid)
                        snapshots[int(pid)] = value
                    except Exception as exc:
                        errors[int(pid)] = str(exc)
            except Exception as exc:
                errors.update({pid: str(exc) for pid in pids})
            all_ids = []
            for snapshot in snapshots.values():
                all_ids.extend(str(safe_int(row.get('item_key'), 0)) for row in snapshot.get('items') or [] if isinstance(row, dict))
            all_ids = [value for value in all_ids if value != '0']
            try:
                if all_ids:
                    self.market_price_service.set_enabled(True)
                    self.market_price_service.request_items(all_ids)
            except Exception as exc:
                errors[-1] = '报价查询：' + str(exc)
            def finish():
                self._warehouse_snapshots.update(snapshots)
                for pid in pids:
                    if pid not in snapshots and pid in self._warehouse_snapshots:
                        self._warehouse_snapshots.pop(pid, None)
                self._warehouse_refresh_busy = False
                self._warehouse_last_refresh = time.time()
                render_warehouse()
                if errors:
                    detail = next(iter(errors.values()))
                    self.warehouse_status_var.set(f'仓库已显示可用数据；部分实例/报价失败：{str(detail)[:80]}')
                if self._warehouse_refresh_queued:
                    self._warehouse_refresh_queued = False
                    self.after(200, lambda: refresh_warehouse(False))
            self.after(0, finish)
        threading.Thread(target=worker, name='仓库物品刷新', daemon=True).start()

    def request_warehouse_prices():
        ids = []
        for snapshot in (getattr(self, '_warehouse_snapshots', {}) or {}).values():
            for row in snapshot.get('items') or []:
                if isinstance(row, dict):
                    item_id = safe_int(row.get('item_key'), 0)
                    if item_id > 0:
                        ids.append(str(item_id))
        if not ids:
            refresh_warehouse(True)
            return
        try:
            self._warehouse_price_query_enabled = True
            self.market_price_service.set_enabled(True)
            missing = self.market_price_service.request_items(ids, force=True)
            self.warehouse_status_var.set(f'已提交手动报价刷新（涉及 {len(set(ids))} 种物品）；刷新成功后替换缓存并同步给自动交易船。')
            self.after(1000, render_warehouse)
        except Exception as exc:
            self.warehouse_status_var.set('报价查询失败：' + str(exc))

    def manual_trade_ship_round():
        if not self.ensure_activated(show_dialog=True):
            return
        if not self.backend.connected():
            messagebox.showinfo('交易船', '请先连接游戏实例。', parent=self)
            return
        if self._manual_trade_ship_busy:
            self.thread_log('手动转入交易船：上一轮仍在处理，请稍候。')
            return
        self._manual_trade_ship_busy = True
        try:
            self.manual_trade_ship_button.configure(state='disabled')
            self.warehouse_status_var.set('正在读取可交易物品及报价缓存…')
        except Exception:
            pass

        def worker():
            result_text = ''
            error_text = ''
            try:
                candidate_results, candidate_errors = self.backend.rpc_all('tradeshippricecandidates')
                item_ids = set()
                for raw in candidate_results.values():
                    try:
                        value = json.loads(raw) if isinstance(raw, str) else raw
                        if isinstance(value, list):
                            item_ids.update(str(item_id) for item_id in value
                                            if str(item_id).isdigit() and int(item_id) > 0)
                    except Exception:
                        continue
                self._warehouse_price_query_enabled = True
                self.market_price_service.set_enabled(True)
                if item_ids:
                    self.market_price_service.request_items(sorted(item_ids))
                deadline = time.monotonic() + 90
                while item_ids and time.monotonic() < deadline:
                    try:
                        with self.market_price_service.lock:
                            pending = set(getattr(self.market_price_service, '_requested_item_ids', set()))
                            retry_at = float(getattr(self.market_price_service, 'retry_at', 0) or 0)
                        if not pending or retry_at > time.time():
                            break
                    except Exception:
                        break
                    time.sleep(0.5)
                self.sync_market_prices()
                trade_results, trade_errors = self.backend.rpc_all('autotradeshiponce')
                started = []
                failed = []
                for pid, raw in trade_results.items():
                    try:
                        value = json.loads(raw) if isinstance(raw, str) else raw
                        message = value.get('message') or value.get('status') if isinstance(value, dict) else str(value)
                        started.append(f'{pid}: {message}')
                    except Exception:
                        started.append(f'{pid}: {raw}')
                failed.extend(f'{pid}: {message}' for pid, message in trade_errors.items())
                failed.extend(f'报价候选读取 {pid}: {message}' for pid, message in candidate_errors.items())
                result_text = '；'.join(started) if started else '没有已连接实例接受本轮请求'
                if failed:
                    error_text = '；'.join(failed)
            except Exception as exc:
                error_text = str(exc)
            finally:
                def finish():
                    self._manual_trade_ship_busy = False
                    try:
                        self.manual_trade_ship_button.configure(state='normal' if self.backend.connected() else 'disabled')
                    except Exception:
                        pass
                    if error_text:
                        self.warehouse_status_var.set('手动转入提交异常：' + error_text[:140])
                        self.thread_log('手动转入交易船失败/部分失败：' + error_text)
                    else:
                        self.warehouse_status_var.set('手动转入一轮已启动：' + result_text[:140])
                        self.thread_log('手动转入交易船一轮已提交：' + result_text)
                try:
                    self.after(0, finish)
                except Exception:
                    pass

        threading.Thread(target=worker, name='手动交易船转入', daemon=True).start()

    self._ui_game_windows_hidden = False
    self._ui_hidden_game_windows = {}
    self._account_window_buttons = {}
    self._account_frame_vars = {}
    self._account_frame_status_vars = {}
    self._account_frame_buttons = {}
    self._ui_frame_busy = set()
    self._ui_frame_results = {}
    self._ui_frame_loaded = set()
    self._ui_window_pending = {}

    def sync_window_controls():
        self._ui_game_windows_hidden = bool(self._ui_hidden_game_windows)
        self.hide_game_button.configure(text='显示游戏窗口' if self._ui_game_windows_hidden else '隐藏游戏窗口')
        for pid, button in self._account_window_buttons.items():
            if button.winfo_exists():
                pending = self._ui_window_pending.get(pid)
                button.configure(text=('隐藏中…' if pending['hide'] else '恢复中…') if pending else
                    ('显示窗口' if pid in self._ui_hidden_game_windows else '隐藏窗口'),
                    state='disabled' if pending else 'normal')

    def set_process_windows(pid, hide, closing=False):
        from ctypes import wintypes
        pid = int(pid)
        user32 = ctypes.WinDLL('user32', use_last_error=True)
        user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        user32.GetWindowThreadProcessId.restype = wintypes.DWORD
        for name in ('IsWindow', 'IsWindowVisible', 'IsIconic'):
            function = getattr(user32, name)
            function.argtypes = [wintypes.HWND]
            function.restype = wintypes.BOOL
        user32.ShowWindowAsync.argtypes = [wintypes.HWND, ctypes.c_int]
        user32.ShowWindowAsync.restype = wintypes.BOOL
        callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
        user32.EnumWindows.restype = wintypes.BOOL
        count = 0
        if pid in self._ui_window_pending:
            if not closing:
                return 0
            self._ui_window_pending.pop(pid, None)
        requested = {}
        def belongs_to_process(hwnd):
            current_pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(current_pid))
            return bool(user32.IsWindow(hwnd)) and current_pid.value == pid
        if hide:
            tracked = self._ui_hidden_game_windows.setdefault(pid, {})
            def visit(hwnd, _lparam):
                nonlocal count
                if belongs_to_process(hwnd) and user32.IsWindowVisible(hwnd):
                    minimized = bool(user32.IsIconic(hwnd))
                    if user32.ShowWindowAsync(hwnd, 0):
                        tracked[int(hwnd)] = minimized
                        requested[int(hwnd)] = minimized
                        count += 1
                return True
            callback = callback_type(visit)
            if not user32.EnumWindows(callback, 0):
                raise ctypes.WinError(ctypes.get_last_error())
            if not tracked:
                self._ui_hidden_game_windows.pop(pid, None)
        else:
            tracked = self._ui_hidden_game_windows.get(pid, {})
            for hwnd, was_minimized in list(tracked.items()):
                if belongs_to_process(hwnd):
                    if user32.ShowWindowAsync(hwnd, 7 if was_minimized else 8):
                        requested[hwnd] = was_minimized
                        count += 1
                else:
                    tracked.pop(hwnd, None)
            if not tracked:
                self._ui_hidden_game_windows.pop(pid, None)
        if requested and not closing:
            pending = {'hide': hide, 'handles': requested, 'deadline': time.monotonic() + 2}
            self._ui_window_pending[pid] = pending

            def verify():
                if getattr(self, 'shutting_down', False):
                    return
                if self._ui_window_pending.get(pid) is not pending:
                    return
                tracked = self._ui_hidden_game_windows.get(pid, {})
                waiting = []
                for hwnd in requested:
                    if not belongs_to_process(hwnd):
                        tracked.pop(hwnd, None)
                    elif bool(user32.IsWindowVisible(hwnd)) == (not hide):
                        if not hide:
                            tracked.pop(hwnd, None)
                    else:
                        waiting.append(hwnd)
                if not tracked:
                    self._ui_hidden_game_windows.pop(pid, None)
                if waiting and time.monotonic() < pending['deadline']:
                    self.after(100, verify)
                    return
                self._ui_window_pending.pop(pid, None)
                if waiting:
                    self.thread_log(f'[进程 {pid}] 窗口状态确认超时，可再次操作；其他账号继续处理。')
                sync_window_controls()
            verify()
        sync_window_controls()
        return count

    def toggle_process_windows(pid):
        try:
            hide = int(pid) not in self._ui_hidden_game_windows
            count = set_process_windows(pid, hide)
            if not count:
                messagebox.showinfo('游戏窗口', f'进程 {pid} 当前没有可操作的游戏窗口。', parent=self)
            else:
                self.thread_log(f'[进程 {pid}] 已提交' + ('隐藏' if hide else '显示') + f'窗口请求，共 {count} 个。')
        except Exception as exc:
            messagebox.showerror('游戏窗口', str(exc), parent=self)

    def refresh_frame_controls(pid):
        button = self._account_frame_buttons.get(pid)
        if button is not None and button.winfo_exists():
            button.configure(state='disabled' if pid in self._ui_frame_busy else 'normal')
        variable = self._account_frame_status_vars.get(pid)
        if variable is not None:
            if pid in self._ui_frame_busy:
                variable.set('读取 / 设置中…')
            else:
                variable.set(self._ui_frame_results.get(pid, '待读取帧率'))

    def request_process_frame_limit(pid, apply=False):
        pid = int(pid)
        if pid in self._ui_frame_busy or getattr(self, 'shutting_down', False):
            return
        variable = self._account_frame_vars.get(pid)
        fps_values = {'不限': 0, '10 FPS': 10, '15 FPS': 15, '30 FPS': 30}
        requested = fps_values.get(variable.get()) if apply and variable is not None else None
        if apply and requested is None:
            return
        self._ui_frame_busy.add(pid)
        refresh_frame_controls(pid)
        def worker():
            result, error = None, ''
            try:
                raw = self.backend.rpc_one(pid, 'setframelimit', requested) if apply else self.backend.rpc_one(pid, 'getframelimit')
                result = json.loads(raw) if isinstance(raw, str) else raw
                if not isinstance(result, dict) or result.get('status') != 'SUCCESS':
                    raise RuntimeError(str((result or {}).get('error') if isinstance(result, dict) else result))
                if apply:
                    target = -1 if requested == 0 else requested
                    if result.get('targetFrameRate') != target or result.get('vsync') != 0:
                        raise RuntimeError('Unity 回读帧率与设置不一致')
            except Exception as exc:
                error = str(exc)[:150]
            def finish():
                self._ui_frame_busy.discard(pid)
                if getattr(self, 'shutting_down', False):
                    return
                if error:
                    self._ui_frame_results[pid] = '锁帧失败' if apply else '读取失败'
                    self.thread_log(f'[进程 {pid}] 帧率操作失败：{error}')
                    if apply:
                        messagebox.showerror('锁帧失败', f'进程 {pid}：{error}', parent=self)
                else:
                    actual = int(result.get('targetFrameRate', -1))
                    display = '不限' if actual < 0 else f'{actual} FPS'
                    self._ui_frame_results[pid] = 'Unity：' + display
                    current_var = self._account_frame_vars.get(pid)
                    if current_var is not None and (apply or display in fps_values):
                        current_var.set(display)
                    if apply:
                        self.thread_log(f'[进程 {pid}] 锁帧已应用：{display}，VSync {result.get("vsync")}。')
                refresh_frame_controls(pid)
            try:
                self.after(0, finish)
            except Exception:
                pass
        threading.Thread(target=worker, name=f'游戏锁帧-{pid}', daemon=True).start()

    def toggle_game_windows():
        try:
            pids = {int(row.get('pid') or 0) for row in self.backend.target_snapshot() if int(row.get('pid') or 0) > 0}
        except Exception as exc:
            self.thread_log(f'读取游戏进程失败：{exc}')
            return
        if not pids and not self._ui_hidden_game_windows:
            messagebox.showinfo('游戏窗口', '请先连接游戏实例。', parent=self)
            return
        hidden = bool(self._ui_game_windows_hidden)
        found = 0
        try:
            for pid in list(self._ui_hidden_game_windows) if hidden else pids:
                found += set_process_windows(pid, not hidden)
            self.thread_log(('已提交显示' if hidden else '已提交隐藏') + f' {found} 个游戏窗口请求；游戏进程仍在运行。')
        except Exception as exc:
            messagebox.showerror('游戏窗口', str(exc), parent=self)

    self._ui_select_page = select_page
    self._ui_update_summaries = update_summaries
    self._ui_refresh_summaries = refresh_summaries
    self._ui_stop_all = stop_all
    self._ui_start_automation = start_automation
    self._ui_toggle_game_windows = toggle_game_windows
    self._ui_set_process_windows = set_process_windows
    self._ui_toggle_process_windows = toggle_process_windows
    self._ui_request_process_frame_limit = request_process_frame_limit

    # A reconnect may return an existing target with an empty `added` list.
    # The base controller then skips its normal config broadcast. Complete a
    # pending one-click start after every successful connection callback.
    original_on_connected = self.on_connected
    def on_connected_after_one_click(summary=None, quiet=False):
        result = original_on_connected(summary, quiet)
        if getattr(self, '_ui_start_after_attach', False) and self.backend.connected():
            self._ui_start_after_attach = False
            try:
                self.after(150, self.apply_runtime_config)
            except Exception as exc:
                self.thread_log(f'一键开启：连接已恢复，但应用配置失败：{exc}')
        return result
    self.on_connected = on_connected_after_one_click

    # Keep the latest map/box decision visible in diagnostics. This makes a
    # deliberate skip (already on the target map, boss instance, ticket
    # priority, game cooldown, etc.) distinguishable from a stalled worker.
    original_runtime_health_check = self.repair_instance_runtime_health
    self._ui_runtime_reason_log_state = {}
    self._account_identity_by_pid = {}
    self._account_name_vars = {}
    def apply_account_identities(identities):
        if getattr(self, 'shutting_down', False):
            return
        for pid, identity in identities.items():
            self._account_identity_by_pid[pid] = identity
            variable = self._account_name_vars.get(pid)
            if variable is not None:
                variable.set('用户名：' + (identity.get('displayName') or '待读取'))

    def runtime_health_with_feature_reason(instances):
        now = time.monotonic()
        identities = {}
        for instance in instances or []:
            if not isinstance(instance, dict):
                continue
            pid = safe_int(instance.get('pid'), 0)
            status = instance.get('status') or {}
            if pid <= 0 or not isinstance(status, dict):
                continue
            identity = status.get('accountIdentity') or {}
            if isinstance(identity, dict) and safe_int(identity.get('pid'), 0) == pid:
                name = ''.join(ch for ch in str(identity.get('displayName') or '') if ch.isprintable()).strip()[:128]
                identities[pid] = {'displayName': name, 'source': str(identity.get('source') or '')}
            details = {
                'lastTradeShipResult': str(status.get('lastTradeShipResult') or ''),
                'tradeShipCount': safe_int(status.get('tradeShipCount'), 0),
                'tradeShipCandidateCount': safe_int(status.get('lastTradeShipCandidateCount'), 0),
                'tradeShipWaitingCount': safe_int(status.get('tradeShipWaitingCount'), 0),
                'tradeShipQueued': bool(status.get('tradeShipQueued')),
                'tradeShipMoveResultCallbackReady': bool(status.get('tradeShipMoveResultCallbackReady')),
                'tradeShipPending': (lambda pending: {
                    'phase': str(pending.get('phase') or ''),
                    'targetSlot': safe_int(pending.get('targetSlot'), -1),
                    'itemKey': safe_int(pending.get('itemKey'), 0),
                    'uploadInvoked': bool(pending.get('uploadInvoked')),
                    'warningSeen': bool(pending.get('warningSeen')),
                    'warningDismissInvoked': bool(pending.get('warningDismissInvoked')),
                    'undoInvoked': bool(pending.get('undoInvoked')),
                    'startedAt': safe_int(pending.get('startedAt'), 0),
                    'confirmedAt': safe_int(pending.get('confirmedAt'), 0),
                } if isinstance(pending, dict) else None)(status.get('tradeShipPending')),
                'tradeShipWarningDiagnostics': status.get('tradeShipWarningDiagnostics'),
                'itemLockMethodDiagnostics': status.get('itemLockMethodDiagnostics'),
                'tradeShipSlotLayout': status.get('tradeShipSlotLayout'),
                'autoPlaguePortalUi': status.get('autoPlaguePortalUi'),
                'autoPlagueMapEnabled': bool(status.get('autoPlagueMapEnabled')),
                'autoPlagueDifficulty': status.get('autoPlagueDifficulty'),
                'autoPlagueStageNo': status.get('autoPlagueStageNo'),
                'autoPlagueLastResult': str(status.get('autoPlagueLastResult') or ''),
                'autoPlagueLastPassPhase': str(status.get('autoPlagueLastPassPhase') or ''),
                'autoPlagueCurrentStageReadError': str(status.get('autoPlagueCurrentStageReadError') or ''),
                'autoPlagueSwitchQueued': bool(status.get('autoPlagueSwitchQueued')),
                'autoPlaguePortalCloseQueued': bool(status.get('autoPlaguePortalCloseQueued')),
                'autoPlaguePortalCloseHandledStageKey': safe_int(status.get('autoPlaguePortalCloseHandledStageKey'), 0),
                'autoPlaguePortalCloseAttempts': safe_int(status.get('autoPlaguePortalCloseAttempts'), 0),
                'autoPlagueCurrentStage': status.get('autoPlagueCurrentStage'),
                'autoPlaguePassCount': safe_int(status.get('autoPlaguePassCount'), 0),
                'autoPlagueNextCheckAt': safe_int(status.get('autoPlagueNextCheckAt'), 0),
                'autoPlagueCheckIntervalMs': safe_int(status.get('autoPlagueCheckIntervalMs'), 0),
                'lastMapSwitchAt': safe_int(status.get('lastMapSwitchAt'), 0),
                'running': bool(status.get('running')),
                'cyclePhase': str(status.get('cyclePhase') or ''),
                'lastBoxCount': safe_int(status.get('lastBoxCount'), 0),
                'lastBoxOpenResult': str(status.get('lastBoxOpenResult') or ''),
                'boxScanIntervalMs': safe_int(status.get('boxScanIntervalMs'), 0),
                'lastBoxPumpAt': safe_int(status.get('lastBoxPumpAt'), 0),
            }
            signature = json.dumps({key: value for key, value in details.items()
                if key not in ('autoPlaguePassCount', 'autoPlagueNextCheckAt',
                               'lastMapSwitchAt')}, ensure_ascii=False, sort_keys=True)
            previous = self._ui_runtime_reason_log_state.get(pid, {})
            if signature != previous.get('signature') or now - float(previous.get('loggedAt', 0)) >= 60:
                file_log('runtime-health', 'map-box-feature-status', {'pid': pid, **details})
                self._ui_runtime_reason_log_state[pid] = {'signature': signature, 'loggedAt': now}
        if identities:
            try:
                self.after(0, lambda values=identities: apply_account_identities(values))
            except Exception:
                pass
        return original_runtime_health_check(instances)
    self.repair_instance_runtime_health = runtime_health_with_feature_reason

    sidebar = ttk.Frame(self, style='Sidebar.TFrame', padding=(12, 17, 10, 10))
    sidebar.grid(row=0, column=0, sticky='nsew')
    sidebar.columnconfigure(0, weight=1)
    sidebar.rowconfigure(2, weight=1)
    sidebar.configure(width=218)
    sidebar.grid_propagate(False)

    brand = ttk.Frame(sidebar, style='Sidebar.TFrame', padding=(5, 3, 3, 18))
    brand.grid(row=0, column=0, sticky='ew')
    brand.columnconfigure(0, weight=1)
    self._brand_photo = None
    try:
        from PIL import Image, ImageTk
        brand_source = Image.open(BUNDLE_DIR / 'imgs' / 'brand-lockup.png').convert('RGBA')
        brand_width = 188
        brand_height = max(34, round(brand_width * brand_source.height / max(1, brand_source.width)))
        brand_icon = brand_source.resize((brand_width, brand_height), Image.LANCZOS)
        self._brand_photo = ImageTk.PhotoImage(brand_icon)
        ttk.Label(brand, image=self._brand_photo, style='Panel.TLabel').grid(row=0, column=0, sticky='w')
    except Exception:
        ttk.Label(brand, text='TBH助手', style='Panel.TLabel', font=('Microsoft YaHei UI', 14, 'bold')).grid(row=0, column=0, sticky='w')
    ttk.Separator(sidebar, orient='horizontal').grid(row=1, column=0, sticky='ew', pady=(0, 12))

    nav = ttk.Frame(sidebar, style='Sidebar.TFrame')
    nav.grid(row=2, column=0, sticky='new')
    nav.columnconfigure(0, weight=1)
    pages_spec = [
        ('accounts', '账号', '本机与沙盒实例，按账号连接', '#0087A5'),
        ('overview', '概览', '运行状态与常用模块', '#B2740E'),
        ('magic', '魔方', '合成与自动腐蚀设置', '#7B50CC'),
        ('map', '地图', '门票挑战与地图前往', '#008A9F'),
        ('drop_preview', '掉落预览', '查看当前关卡的后续掉落队列', '#258A74'),
        ('warehouse', '仓库', '仓库、交易船与物品查询', '#B66513'),
        ('stats', '统计', '宝箱与掉落数据汇总', '#2F7CD3'),
        ('logs', '日志', '自动化运行记录', '#A46B36'),
        ('settings', '设置/setting', '连接与程序选项', '#5174A7'),
        ('help', '说明', '使用说明与风险提示', '#3C8B5A'),
    ]
    self._ui_pages = {}
    self._ui_page_contents = {}
    self._navigation_buttons = {}
    self._ui_page_titles = {key: (title, subtitle) for key, title, subtitle, _color in pages_spec}

    def draw_nav_icon(canvas, key, color):
        canvas.delete('all')
        line = {'fill': color, 'width': 1.8, 'capstyle': 'round', 'joinstyle': 'round'}
        if key == 'accounts':
            canvas.create_rectangle(4, 4, 20, 20, outline=color, width=1.8)
            canvas.create_oval(9, 7, 15, 13, outline=color, width=1.5)
            canvas.create_arc(7, 11, 17, 19, start=20, extent=140, style='arc', outline=color, width=1.6)
        elif key == 'overview':
            canvas.create_polygon(12, 3, 19, 6, 18, 14, 12, 21, 6, 14, 5, 6, outline=color, fill='', width=1.7)
            canvas.create_line(12, 7, 12, 14, **line)
            canvas.create_oval(10.8, 16, 13.2, 18.4, outline=color, fill=color, width=1)
        elif key == 'magic':
            canvas.create_polygon(12, 3, 20, 7, 12, 11, 4, 7, outline=color, fill='', width=1.7)
            canvas.create_polygon(4, 7, 12, 11, 12, 21, 4, 17, outline=color, fill='', width=1.7)
            canvas.create_polygon(20, 7, 12, 11, 12, 21, 20, 17, outline=color, fill='', width=1.7)
        elif key == 'map':
            canvas.create_oval(4, 4, 20, 20, outline=color, width=1.7)
            canvas.create_oval(9, 9, 15, 15, outline=color, width=1.5)
            canvas.create_polygon(12, 5, 14, 12, 12, 11, 10, 15, outline=color, fill=color, width=0.8)
        elif key == 'drop_preview':
            canvas.create_oval(3, 5, 21, 19, outline=color, width=1.7)
            canvas.create_oval(9, 8, 15, 16, outline=color, width=1.6)
            canvas.create_oval(11, 10, 13, 14, outline=color, fill=color, width=1)
        elif key == 'warehouse':
            canvas.create_polygon(3, 8, 12, 3, 21, 8, 21, 19, 3, 19, outline=color, fill='', width=1.7)
            canvas.create_line(3, 8, 21, 8, **line)
            canvas.create_rectangle(9, 12, 15, 19, outline=color, width=1.5)
        elif key == 'stats':
            canvas.create_line(4, 20, 21, 20, **line)
            canvas.create_rectangle(5, 13, 8, 19, outline=color, width=1.5)
            canvas.create_rectangle(10, 9, 13, 19, outline=color, width=1.5)
            canvas.create_rectangle(15, 5, 18, 19, outline=color, width=1.5)
        elif key == 'logs':
            canvas.create_polygon(5, 3, 16, 3, 20, 7, 20, 21, 5, 21, outline=color, fill='', width=1.6)
            canvas.create_line(15, 3, 15, 8, 20, 8, **line)
            canvas.create_line(8, 11, 17, 11, **line)
            canvas.create_line(8, 14, 17, 14, **line)
            canvas.create_line(8, 17, 15, 17, **line)
        elif key == 'settings':
            canvas.create_oval(6, 6, 18, 18, outline=color, width=1.7)
            canvas.create_oval(10, 10, 14, 14, outline=color, width=1.5)
            for x1, y1, x2, y2 in ((12, 2, 12, 6), (12, 18, 12, 22), (2, 12, 6, 12), (18, 12, 22, 12), (5, 5, 8, 8), (16, 16, 19, 19), (5, 19, 8, 16), (16, 8, 19, 5)):
                canvas.create_line(x1, y1, x2, y2, **line)
        elif key == 'help':
            canvas.create_polygon(3, 5, 10, 6, 12, 8, 14, 6, 21, 5, 21, 19, 14, 20, 12, 22, 10, 20, 3, 19, outline=color, fill='', width=1.6)
            canvas.create_line(12, 8, 12, 21, **line)
            canvas.create_line(5, 9, 9, 10, **line)
            canvas.create_line(15, 10, 19, 9, **line)

    for index, (key, title, subtitle, icon_color) in enumerate(pages_spec):
        selected = key == 'accounts'
        row_color = '#EAF3F5' if selected else colors['panel']
        row = tk.Frame(nav, background=row_color, bd=0, highlightthickness=0, cursor='hand2')
        row.grid(row=index, column=0, sticky='ew', pady=3)
        row.columnconfigure(2, weight=1)
        marker = tk.Frame(row, width=3, background=icon_color if selected else row_color)
        marker.grid(row=0, column=0, sticky='nsw')
        icon = tk.Canvas(row, width=24, height=24, background=row_color, highlightthickness=0, borderwidth=0)
        icon.grid(row=0, column=1, sticky='w', padx=(9, 9), pady=8)
        draw_nav_icon(icon, key, icon_color)
        label = tk.Label(row, text=title, background=row_color, foreground=colors['text'] if selected else colors['muted'], font=('Microsoft YaHei UI', 10, 'bold' if selected else 'normal'), anchor='w')
        label.grid(row=0, column=2, sticky='ew', pady=8, padx=(0, 8))
        action = lambda _event, selected_key=key: self._ui_select_page(selected_key)
        for widget in (row, marker, icon, label):
            widget.bind('<Button-1>', action, add='+')
        self._navigation_buttons[key] = (row, icon, label, marker)
    ttk.Label(sidebar, text='本地自动化工具', style='PanelMuted.TLabel').grid(row=3, column=0, sticky='sw', pady=(12, 1))

    main = ttk.Frame(self, style='TFrame', padding=(0, 0, 0, 0))
    main.grid(row=0, column=1, sticky='nsew')
    main.columnconfigure(0, weight=1)
    main.rowconfigure(1, weight=1)
    header = ttk.Frame(main, style='TFrame', padding=(24, 15, 18, 11))
    header.grid(row=0, column=0, sticky='ew')
    header.columnconfigure(0, weight=1)
    title_box = ttk.Frame(header, style='TFrame')
    title_box.grid(row=0, column=0, sticky='w')
    ttk.Label(title_box, text='TBH  /  CONTROL CENTER', style='Eyebrow.TLabel').grid(row=0, column=0, sticky='w')
    self.page_title_var = tk.StringVar(value='概览')
    self.page_subtitle_var = tk.StringVar(value='运行状态与常用模块')
    ttk.Label(title_box, textvariable=self.page_title_var, style='PageTitle.TLabel').grid(row=1, column=0, sticky='w', pady=(2, 0))
    ttk.Label(title_box, textvariable=self.page_subtitle_var, style='PageSubtitle.TLabel').grid(row=2, column=0, sticky='w', pady=(1, 0))
    self.header_links = ttk.Frame(title_box, style='TFrame')
    self.header_links.grid(row=1, column=1, sticky='w', padx=(14, 0))
    self.github_release_button = ttk.Button(self.header_links, text='GitHub 发布页', style='Utility.TButton',
        command=lambda: self._open_external_link('https://github.com/buguniaoOVO/TBHHelper/releases/latest'))
    self.github_release_button.pack(side='left', padx=(0, 5))
    self.sponsor_button = ttk.Button(self.header_links, text='♥ 赞助', style='Sponsor.TButton',
        command=lambda: self._open_external_link('https://afdian.com/a/Awan0v0?utm_source=copylink&utm_medium=link'))
    self.sponsor_button.pack(side='left')

    top_tools = ttk.Frame(header, style='TFrame')
    top_tools.grid(row=0, column=1, rowspan=3, sticky='e', padx=(14, 0))
    self.status_var = tk.StringVar(value='等待游戏连接')
    status_pill = ttk.Label(top_tools, textvariable=self.status_var, style='Pill.TLabel', justify='left', wraplength=190)
    status_pill.grid(row=0, column=0, sticky='e', padx=(0, 5), pady=3)
    self.auto_state_var = tk.StringVar(value='自动化已停止')
    ttk.Label(top_tools, textvariable=self.auto_state_var, style='PillMuted.TLabel').grid(row=0, column=1, sticky='e', padx=4, pady=3)
    self.auto_start_button = ttk.Button(top_tools, text='一键开启', style='Accent.TButton', command=self.begin_auto_start)
    self.auto_start_button.grid(row=0, column=2, sticky='e', padx=4, pady=3)
    self.stop_all_button = ttk.Button(top_tools, text='全部关闭', style='Utility.TButton', command=self._ui_stop_all)
    self.stop_all_button.grid(row=0, column=3, sticky='e', padx=4, pady=3)
    self.hide_game_button = ttk.Button(top_tools, text='隐藏游戏窗口', style='Utility.TButton', command=self._ui_toggle_game_windows)
    self.hide_game_button.grid(row=0, column=4, sticky='e', padx=4, pady=3)
    self.exit_button = ttk.Button(top_tools, text='退出助手', style='Utility.TButton', command=self.on_close)
    self.exit_button.grid(row=0, column=5, sticky='e', padx=(4, 0), pady=3)

    self.page_host = ttk.Frame(main, style='TFrame')
    self.page_host.grid(row=1, column=0, sticky='nsew', padx=(18, 18), pady=(0, 8))
    self.page_host.columnconfigure(0, weight=1)
    self.page_host.rowconfigure(0, weight=1)

    def scrollable_page(key):
        shell = ttk.Frame(self.page_host, style='TFrame')
        shell.grid(row=0, column=0, sticky='nsew')
        shell.grid_remove()
        shell.columnconfigure(0, weight=1)
        shell.rowconfigure(0, weight=1)
        canvas = tk.Canvas(shell, background=colors['background'], highlightthickness=0, borderwidth=0)
        canvas.grid(row=0, column=0, sticky='nsew')
        scroll = ttk.Scrollbar(shell, orient='vertical', command=canvas.yview)
        scroll.grid(row=0, column=1, sticky='ns')
        canvas.configure(yscrollcommand=scroll.set)
        inner = ttk.Frame(canvas, style='TFrame', padding=(4, 2, 8, 16))
        inner.columnconfigure(0, weight=1)
        window_id = canvas.create_window((0, 0), window=inner, anchor='nw')
        inner.bind('<Configure>', lambda _event, c=canvas: c.configure(scrollregion=c.bbox('all')))
        canvas.bind('<Configure>', lambda event, c=canvas, item=window_id: c.itemconfigure(item, width=max(1, event.width)))
        self._ui_pages[key] = shell
        self._dashboard_sections.append(inner)
        return inner

    def scroll_active_page(event):
        shell = self._ui_pages.get(getattr(self, '_current_ui_page', ''))
        if shell is None:
            return
        try:
            widget = self.winfo_containing(event.x_root, event.y_root)
            if isinstance(widget, (ttk.Treeview, tk.Text, tk.Listbox)):
                if widget.yview() != (0.0, 1.0):
                    return
            current = widget
            while current is not None and current is not shell:
                current = getattr(current, 'master', None)
            if current is shell:
                canvas = next((child for child in shell.winfo_children() if isinstance(child, tk.Canvas)), None)
                if canvas is not None:
                    canvas.yview_scroll(-int(event.delta / 120) if abs(event.delta) >= 120 else (-1 if event.delta > 0 else 1), 'units')
        except (tk.TclError, AttributeError):
            return

    self.bind('<MouseWheel>', scroll_active_page, add='+')

    def card(parent, title, subtitle=None, padding=(16, 14)):
        box = tk.Frame(parent, background=colors['panel'], highlightbackground=colors['border'], highlightthickness=1, bd=0)
        inside = ttk.Frame(box, style='Panel.TFrame', padding=padding)
        inside.pack(fill='both', expand=True)
        heading = ttk.Frame(inside, style='Panel.TFrame')
        if title or subtitle:
            heading.pack(fill='x')
        if title:
            ttk.Label(heading, text=title, style='Panel.TLabel', font=('Microsoft YaHei UI', 10, 'bold')).pack(anchor='w')
        if subtitle:
            ttk.Label(heading, text=subtitle, style='PanelMuted.TLabel', wraplength=900, justify='left').pack(anchor='w', pady=(4, 0))
        body = ttk.Frame(inside, style='Panel.TFrame')
        body.pack(fill='both', expand=True, pady=(8, 0) if title or subtitle else 0)
        return box, body

    def page_heading(parent, title, subtitle):
        ttk.Label(parent, text=title, style='ChallengeHeading.TLabel').grid(row=0, column=0, sticky='w', pady=(5, 2))
        ttk.Label(parent, text=subtitle, style='Muted.TLabel').grid(row=1, column=0, sticky='w', pady=(0, 12))

    for key, _, _, _ in pages_spec:
        self._ui_page_contents[key] = scrollable_page(key)

    self._dashboard_sections = list(self._ui_pages.values())

    # Overview page
    overview = self._ui_page_contents['overview']
    overview.columnconfigure(0, weight=1)
    page_heading(overview, '运行概览', '连接状态、自动化任务与常用入口')
    summary_row = ttk.Frame(overview, style='TFrame')
    summary_row.grid(row=2, column=0, sticky='ew', pady=(0, 12))
    for column in range(3):
        summary_row.columnconfigure(column, weight=1, uniform='summary')
    status_card, status_body = card(summary_row, '游戏状态', padding=(16, 13))
    status_card.grid(row=0, column=0, sticky='nsew', padx=(0, 6))
    ttk.Label(status_body, textvariable=self.status_var, style='StatusValue.TLabel', wraplength=310, justify='left').pack(anchor='w', pady=(9, 4))
    ttk.Label(status_body, text='按游戏 PID 连接；沙盒实例使用独立 worker。', style='PanelMuted.TLabel', wraplength=330).pack(anchor='w')
    automation_card, automation_body = card(summary_row, '自动化', padding=(16, 13))
    automation_card.grid(row=0, column=1, sticky='nsew', padx=6)
    ttk.Label(automation_body, textvariable=self.auto_state_var, style='StatusValue.TLabel').pack(anchor='w', pady=(9, 4))
    ttk.Label(automation_body, text='合成、开箱、腐蚀、Boss 挑战及交易船规则。', style='PanelMuted.TLabel', wraplength=320).pack(anchor='w')
    corrosion_card, corrosion_body = card(summary_row, '腐蚀任务', padding=(16, 13))
    corrosion_card.grid(row=0, column=2, sticky='nsew', padx=(6, 0))
    self.corrosion_summary_var = tk.StringVar(value='未启用')
    ttk.Label(corrosion_body, textvariable=self.corrosion_summary_var, style='CardValue.TLabel').pack(anchor='w', pady=(4, 0))
    ttk.Label(corrosion_body, text='按当前腐蚀品级与仓库范围处理。', style='PanelMuted.TLabel', wraplength=320).pack(anchor='w')

    links = ttk.Frame(overview, style='TFrame')
    links.grid(row=3, column=0, sticky='ew', pady=(0, 12))
    for column in range(3):
        links.columnconfigure(column, weight=1, uniform='quick')
    for column, (key, title, description) in enumerate((('magic', '魔方', '合成与自动腐蚀'), ('map', '地图', '门票挑战与掉落巡查'), ('warehouse', '仓库', '交易船、存仓与查询'))):
        box, body = card(links, title, description, padding=(16, 13))
        box.grid(row=0, column=column, sticky='nsew', padx=(0 if column == 0 else 6, 0 if column == 2 else 6))
        ttk.Button(body, text='打开设置  →', style='Utility.TButton', command=lambda selected=key: self._ui_select_page(selected)).pack(fill='x', pady=(12, 0))
    quick_box, quick_body = card(overview, '快速开始', padding=(16, 13))
    quick_box.grid(row=4, column=0, sticky='ew', pady=(0, 12))
    ttk.Label(quick_body, text='启动游戏后点击“一键开启”。程序按当前设置连接实例；配置变更会同步到已连接游戏。', style='PanelMuted.TLabel', wraplength=1050, justify='left').pack(anchor='w')
    legal_box, legal_body = card(overview, '使用说明', padding=(16, 13))
    legal_box.grid(row=5, column=0, sticky='ew', pady=(0, 8))
    ttk.Label(legal_body, text='请从可信渠道获取程序。自动化操作可能受到游戏规则限制，使用前请阅读相关规则并自行评估账号风险。', style='PanelMuted.TLabel', wraplength=1050, justify='left').pack(anchor='w')

    # Accounts page
    accounts = self._ui_page_contents['accounts']
    accounts.columnconfigure(0, weight=1)
    page_heading(accounts, '账号与连接', '本机与 Sandboxie 多开实例，按游戏进程分别连接')
    account_actions, account_actions_body = card(accounts, '实例控制', '按 PID 建立连接；点击“刷新实例”查看当前已连接账号。')
    account_actions.grid(row=2, column=0, sticky='ew', pady=(0, 12))
    self.connect_button = ttk.Button(account_actions_body, text='连接 / 重新扫描', style='Accent.TButton', command=self.attach_async)
    self.connect_button.pack(side='left', padx=(0, 8))
    self.instance_status_button = ttk.Button(account_actions_body, text='查看实例状态', style='Utility.TButton', command=self.open_instance_status, state='disabled')
    self.instance_status_button.pack(side='left', padx=4)
    self.auto_start_button.configure(command=self.begin_auto_start)
    ttk.Button(account_actions_body, text='选择沙盒', style='Utility.TButton', command=self.open_sandbox_startup_dialog).pack(side='left', padx=4)
    self.account_count_var = tk.StringVar(value='尚未连接游戏实例')
    ttk.Label(account_actions_body, textvariable=self.account_count_var, style='PanelMuted.TLabel').pack(side='right')
    account_list_box, account_list_body = card(accounts, '游戏实例', '连接后显示进程 PID、运行环境和自动化状态。')
    account_list_box.grid(row=3, column=0, sticky='ew', pady=(0, 12))
    self.account_cards_frame = ttk.Frame(account_list_body, style='Panel.TFrame')
    self.account_cards_frame.pack(fill='both', expand=True, pady=(8, 0))
    self.account_empty_var = tk.StringVar(value='等待连接或刷新实例列表。')
    ttk.Label(self.account_cards_frame, textvariable=self.account_empty_var, style='PanelMuted.TLabel').pack(anchor='w', pady=7)
    connection_box, connection_body = card(accounts, '连接策略', padding=(16, 12))
    connection_box.grid(row=4, column=0, sticky='ew', pady=(0, 10))
    self.auto_attach_var = tk.BooleanVar(value=bool(self.cfg.get('autoAttach', False)) if self.license_valid else False)
    self.auto_attach_switch = ttk.Checkbutton(connection_body, text='自动连接发现的游戏进程', variable=self.auto_attach_var, command=self.on_auto_attach_changed)
    self.auto_attach_switch.pack(anchor='w')
    self.auto_restart_game_var = tk.BooleanVar(value=bool(self.cfg.get('autoRestartGame', False)) if self.license_valid else False)
    self.auto_restart_game_switch = ttk.Checkbutton(connection_body, text='游戏异常退出后自动重启', variable=self.auto_restart_game_var, command=self.on_auto_restart_changed)
    self.auto_restart_game_switch.pack(anchor='w', pady=(3, 0))
    self.auto_start_host_var = tk.BooleanVar(value=bool(self.cfg.get('autoStartHostGame', False)) if self.license_valid else False)
    self.auto_start_host_switch = ttk.Checkbutton(connection_body, text='一键开启宿主机游戏', variable=self.auto_start_host_var, command=self.on_auto_start_options_changed)
    self.auto_start_host_switch.pack(anchor='w', pady=(3, 0))
    self.auto_start_sandbox_var = tk.BooleanVar(value=bool(self.cfg.get('autoStartSandboxGames', False)) if self.license_valid else False)
    self.auto_start_sandbox_switch = ttk.Checkbutton(connection_body, text='一键开启所选沙盒实例', variable=self.auto_start_sandbox_var, command=self.on_auto_start_options_changed)
    self.auto_start_sandbox_switch.pack(anchor='w', pady=(3, 0))
    self.sandbox_startup_button = ttk.Button(connection_body, text='选择沙盒实例…', style='Utility.TButton', command=self.open_sandbox_startup_dialog)
    self.sandbox_startup_button.pack(anchor='w', pady=(8, 0))

    def refresh_account_cards():
        try:
            rows = list(self.backend.target_snapshot()) if self.backend.connected() else []
        except Exception as exc:
            rows = []
            self.account_empty_var.set(f'读取失败：{str(exc)[:120]}')
        for child in self.account_cards_frame.winfo_children():
            child.destroy()
        self._account_name_vars.clear()
        self._account_window_buttons.clear()
        self._account_frame_buttons.clear()
        self._account_frame_status_vars.clear()
        live_pids = {safe_int(target.get('pid'), 0) for target in rows}
        self._ui_frame_loaded.intersection_update(live_pids)
        self._account_identity_by_pid = {pid: value for pid, value in self._account_identity_by_pid.items() if pid in live_pids}
        if not rows:
            self.account_empty_var.set('当前没有已连接的游戏实例。点击“连接 / 重新扫描”读取本机与沙盒进程。')
            ttk.Label(self.account_cards_frame, textvariable=self.account_empty_var, style='PanelMuted.TLabel', wraplength=900).pack(anchor='w', pady=8)
        else:
            self.account_empty_var.set(f'已连接 {len(rows)} 个游戏实例。')
            for target in rows:
                pid = int(target.get('pid') or 0)
                box_name = str(target.get('boxName') or '')
                sandboxed = bool(target.get('sandboxed'))
                label = str(target.get('label') or (f'沙盒 {box_name}' if sandboxed else '本机游戏'))
                item = ttk.Frame(self.account_cards_frame, style='Card.TFrame', padding=(12, 10))
                item.pack(fill='x', pady=4)
                item.columnconfigure(1, weight=1)
                ttk.Label(item, text=f'{label}  ·  PID {pid}', style='Panel.TLabel', font=('Microsoft YaHei UI', 10, 'bold')).grid(row=0, column=0, columnspan=2, sticky='w')
                identity = self._account_identity_by_pid.get(pid) or {}
                name_var = tk.StringVar(value='用户名：' + (identity.get('displayName') or '待读取'))
                self._account_name_vars[pid] = name_var
                ttk.Label(item, textvariable=name_var, style='Panel.TLabel').grid(row=1, column=0, columnspan=2, sticky='w', pady=(4, 0))
                ttk.Label(item, text='Sandboxie worker 已连接' if sandboxed else 'Frida 进程已连接', style='PanelMuted.TLabel').grid(row=2, column=0, sticky='w', pady=(3, 0))
                controls = ttk.Frame(item, style='Card.TFrame')
                controls.grid(row=0, column=2, rowspan=3, sticky='e', padx=(8, 0))
                window_button = ttk.Button(controls, text='显示窗口' if pid in self._ui_hidden_game_windows else '隐藏窗口',
                                           style='Utility.TButton', command=lambda p=pid: toggle_process_windows(p))
                window_button.grid(row=0, column=0, padx=(0, 8))
                self._account_window_buttons[pid] = window_button
                frame_var = self._account_frame_vars.setdefault(pid, tk.StringVar(value='不限'))
                ttk.Combobox(controls, textvariable=frame_var, values=('不限', '10 FPS', '15 FPS', '30 FPS'),
                             state='readonly', width=7).grid(row=0, column=1, padx=(0, 4))
                frame_button = ttk.Button(controls, text='锁帧', style='Utility.TButton',
                                          command=lambda p=pid: request_process_frame_limit(p, apply=True))
                frame_button.grid(row=0, column=2, padx=(0, 8))
                self._account_frame_buttons[pid] = frame_button
                ttk.Button(controls, text='实例详情', style='Utility.TButton', command=self.open_instance_status).grid(row=0, column=3)
                frame_status = tk.StringVar()
                self._account_frame_status_vars[pid] = frame_status
                ttk.Label(controls, textvariable=frame_status, style='PanelMuted.TLabel').grid(row=1, column=1, columnspan=2, pady=(3, 0))
                refresh_frame_controls(pid)
                if pid not in self._ui_frame_loaded:
                    self._ui_frame_loaded.add(pid)
                    self.after(100, lambda p=pid: request_process_frame_limit(p))
            self.account_count_var.set(f'已连接 {len(rows)} 个账号')
        try:
            count = int(self.backend.connection_count())
            self.account_count_var.set(f'已连接 {count} 个账号')
        except Exception:
            pass
        sync_window_controls()
    self.refresh_account_cards = refresh_account_cards
    ttk.Button(account_actions_body, text='刷新实例', style='Utility.TButton', command=refresh_account_cards).pack(side='left', padx=4)

    # Magic page
    magic = self._ui_page_contents['magic']
    magic.columnconfigure(0, weight=1)
    page_heading(magic, '魔方', '装备、首饰、材料合成；腐蚀按品级与仓库范围筛选')
    synthesis_box, synthesis_body = card(magic, '自动合成设置', '合成按类别和品级上限执行；未满足条件的物品保持不变。')
    synthesis_box.grid(row=2, column=0, sticky='ew', pady=(0, 12))
    self.main_enabled_var = tk.BooleanVar(value=bool(self.cfg.get('mainEnabled', False)) if self.license_valid else False)
    self.main_switch = ttk.Checkbutton(synthesis_body, text='启用自动合成', variable=self.main_enabled_var, command=self.apply_runtime_config)
    self.main_switch.grid(row=0, column=0, sticky='w', padx=(0, 18), pady=3)
    self.runtime_controls.append((self.main_switch, 'normal'))
    self.auto_open_boxes_var = tk.BooleanVar(value=bool(self.cfg.get('autoOpenBoxes', False)) if self.license_valid else False)
    self.auto_open_switch = ttk.Checkbutton(synthesis_body, text='自动开启宝箱', variable=self.auto_open_boxes_var, command=self.apply_runtime_config)
    self.auto_open_switch.grid(row=0, column=1, sticky='w', padx=(0, 18), pady=3)
    self.runtime_controls.append((self.auto_open_switch, 'normal'))
    self.auto_deposit_unsynthable_var = tk.BooleanVar(value=bool(self.cfg.get('autoDepositUnsynthable', False)) if self.license_valid else False)
    self.auto_deposit_switch = ttk.Checkbutton(synthesis_body, text='启用定时存放背包物品', variable=self.auto_deposit_unsynthable_var, command=self.apply_runtime_config)
    self.auto_deposit_switch.grid(row=0, column=2, sticky='w', pady=3)
    self.runtime_controls.append((self.auto_deposit_switch, 'normal'))
    self.same_level_synthesis_var = tk.BooleanVar(value=self.cfg.get('sameLevelSynthesis', False) is True)
    ttk.Checkbutton(synthesis_body, text='同等级合成', variable=self.same_level_synthesis_var, command=self.on_rule_changed).grid(row=1, column=0, sticky='w', pady=3)
    cats = self.cfg.get('categories', {})
    max_grades = self.cfg.get('maxGrades', {})
    self.equipment_var = tk.BooleanVar(value=bool(cats.get('equipment', False)) if self.license_valid else True)
    self.accessory_var = tk.BooleanVar(value=bool(cats.get('accessory', False)) if self.license_valid else True)
    self.material_var = tk.BooleanVar(value=bool(cats.get('material', False)) if self.license_valid else True)
    self.equipment_grade_var = tk.StringVar(value=GRADE_VALUE_TO_LABEL.get(int(max_grades.get('equipment', 8)), '神圣及以下'))
    self.accessory_grade_var = tk.StringVar(value=GRADE_VALUE_TO_LABEL.get(int(max_grades.get('accessory', 8)), '神圣及以下'))
    self.material_grade_var = tk.StringVar(value=GRADE_VALUE_TO_LABEL.get(int(max_grades.get('material', 8)), '神圣及以下'))
    self.synthesis_grade_boxes = []
    ttk.Label(synthesis_body, text='合成类别', style='PanelMuted.TLabel').grid(row=2, column=0, sticky='w', pady=(8, 3))
    self._build_category_row(synthesis_body, 3, '装备', self.equipment_var, self.equipment_grade_var)
    self._build_category_row(synthesis_body, 4, '首饰', self.accessory_var, self.accessory_grade_var)
    self._build_category_row(synthesis_body, 5, '材料', self.material_var, self.material_grade_var)
    rule_actions = ttk.Frame(synthesis_body, style='Panel.TFrame')
    rule_actions.grid(row=6, column=0, columnspan=3, sticky='ew', pady=(10, 0))
    self.synthesis_ignore_button = ttk.Button(rule_actions, text='合成忽略清单', style='Utility.TButton', command=self.open_synthesis_ignore)
    self.synthesis_ignore_button.pack(side='left')
    ttk.Label(rule_actions, text='每类物品按独立品级上限筛选。', style='PanelMuted.TLabel').pack(side='left', padx=10)

    timing_row = ttk.Frame(synthesis_body, style='Panel.TFrame')
    timing_row.grid(row=7, column=0, columnspan=3, sticky='ew', pady=(9, 1))
    ttk.Label(timing_row, text='自动开箱检测间隔（分钟）', style='PanelMuted.TLabel').grid(row=0, column=0, sticky='w', padx=(0, 7))
    self.auto_box_interval_var = tk.StringVar(value=str(self.cfg.get('autoBoxCheckIntervalMinutes', 1)))
    self.auto_box_interval_spin = ttk.Spinbox(timing_row, from_=1, to=1440, width=6,
        textvariable=self.auto_box_interval_var, command=self.on_rule_changed)
    self.auto_box_interval_spin.grid(row=0, column=1, sticky='w', padx=(0, 24))
    self.auto_box_interval_spin.bind('<Return>', lambda _event: self.on_rule_changed())
    self.auto_box_interval_spin.bind('<FocusOut>', lambda _event: self.on_rule_changed())
    self.runtime_controls.append((self.auto_box_interval_spin, 'normal'))

    corrosion_box, corrosion_body = card(magic, '自动腐蚀设置', '按分钟检测仓库负载；达到阈值后腐蚀符合品级与保护规则的物品。')
    corrosion_box.grid(row=3, column=0, sticky='ew', pady=(0, 12))
    for column in range(4):
        corrosion_body.columnconfigure(column, weight=1 if column in (1, 3) else 0)
    self.auto_corrosion_var = tk.BooleanVar(value=self.cfg.get('autoCorrosion') is True)
    self.corrosion_grade_var = tk.StringVar(value=CORROSION_GRADE_VALUE_TO_LABEL[normalize_corrosion_grade(self.cfg.get('corrosionMaxGrade'))])
    self.corrosion_stash_var = tk.BooleanVar(value=self.cfg.get('corrosionIncludeStash') is True)
    self.auto_corrosion_switch = ttk.Checkbutton(corrosion_body, text='启用自动腐蚀', variable=self.auto_corrosion_var,
        command=lambda: (self.apply_runtime_config(), refresh_corrosion_status(True)))
    self.auto_corrosion_switch.grid(row=0, column=0, sticky='w', padx=(0, 18), pady=3)
    self.runtime_controls.append((self.auto_corrosion_switch, 'normal'))
    ttk.Label(corrosion_body, text='最高腐蚀品级', style='PanelMuted.TLabel').grid(row=0, column=1, sticky='e', padx=(0, 6))
    self.corrosion_grade_combo = ttk.Combobox(corrosion_body, textvariable=self.corrosion_grade_var, values=list(CORROSION_GRADE_LABEL_TO_VALUE), state='readonly', width=13)
    self.corrosion_grade_combo.grid(row=0, column=2, sticky='w')
    self.corrosion_grade_var.trace_add('write', lambda *_args: self.on_rule_changed())
    self.corrosion_grade_combo.bind('<<ComboboxSelected>>', lambda _event: self.on_rule_changed())
    self.runtime_controls.append((self.corrosion_grade_combo, 'readonly'))
    self.corrosion_stash_switch = ttk.Checkbutton(corrosion_body, text='仓库物品参与腐蚀', variable=self.corrosion_stash_var, command=self.on_rule_changed)
    self.corrosion_stash_switch.grid(row=1, column=0, sticky='w', pady=3)
    self.runtime_controls.append((self.corrosion_stash_switch, 'normal'))
    self.corrosion_interval_var = tk.StringVar(value=str(self.cfg.get('corrosionMinimumIntervalMinutes', 5)))
    ttk.Label(corrosion_body, text='检测间隔（分钟）', style='PanelMuted.TLabel').grid(row=1, column=1, sticky='e', padx=(0, 6))
    self.corrosion_interval_spin = ttk.Spinbox(corrosion_body, from_=1, to=1440, width=6, textvariable=self.corrosion_interval_var, command=self.on_rule_changed)
    self.corrosion_interval_spin.grid(row=1, column=2, sticky='w')
    self.corrosion_interval_spin.bind('<Return>', lambda _event: self.on_rule_changed())
    self.corrosion_interval_spin.bind('<FocusOut>', lambda _event: self.on_rule_changed())
    self.runtime_controls.append((self.corrosion_interval_spin, 'normal'))
    self.corrosion_warehouse_threshold_var = tk.StringVar(value=str(self.cfg.get('corrosionWarehouseThresholdPercent', 50)))
    ttk.Label(corrosion_body, text='仓库占用达到（%）', style='PanelMuted.TLabel').grid(row=2, column=0, sticky='w', pady=3)
    self.corrosion_warehouse_threshold_spin = ttk.Spinbox(corrosion_body, from_=1, to=100, width=6, textvariable=self.corrosion_warehouse_threshold_var, command=self.on_rule_changed)
    self.corrosion_warehouse_threshold_spin.grid(row=2, column=1, sticky='w')
    self.corrosion_warehouse_threshold_spin.bind('<Return>', lambda _event: self.on_rule_changed())
    self.corrosion_warehouse_threshold_spin.bind('<FocusOut>', lambda _event: self.on_rule_changed())
    self.runtime_controls.append((self.corrosion_warehouse_threshold_spin, 'normal'))
    ttk.Label(corrosion_body, text='腐蚀度低于（0 关闭）', style='PanelMuted.TLabel').grid(row=2, column=2, sticky='e', padx=(14, 6), pady=3)
    self.corrosion_pollution_threshold_var = tk.StringVar(value=str(max(0, safe_int(self.cfg.get('corrosionPollutionThreshold'), 300))))
    self.corrosion_pollution_threshold_spin = ttk.Spinbox(corrosion_body, from_=0, to=1000000, width=9,
        textvariable=self.corrosion_pollution_threshold_var, command=self.on_rule_changed)
    self.corrosion_pollution_threshold_spin.grid(row=2, column=3, sticky='w')
    self.corrosion_pollution_threshold_spin.bind('<Return>', lambda _event: self.on_rule_changed())
    self.corrosion_pollution_threshold_spin.bind('<FocusOut>', lambda _event: self.on_rule_changed())
    self.runtime_controls.append((self.corrosion_pollution_threshold_spin, 'normal'))
    self.corrosion_protect_offering_var = tk.BooleanVar(value=self.cfg.get('corrosionProtectOfferingMaterials') is not False)
    self.corrosion_protect_soulstones_var = tk.BooleanVar(value=self.cfg.get('corrosionProtectSoulstones') is not False)
    self.corrosion_protect_jack_var = tk.BooleanVar(value=self.cfg.get('corrosionProtectJackTickets') is not False)
    self.corrosion_protect_relics_var = tk.BooleanVar(value=self.cfg.get('corrosionProtectRelics') is not False)
    protected_row = ttk.Frame(corrosion_body, style='Panel.TFrame')
    protected_row.grid(row=3, column=0, columnspan=4, sticky='ew', pady=(4, 2))
    for column, (label, variable) in enumerate((('跳过供奉材料', self.corrosion_protect_offering_var),
            ('跳过灵魂石', self.corrosion_protect_soulstones_var), ('跳过杰克入场券', self.corrosion_protect_jack_var),
            ('跳过圣物', self.corrosion_protect_relics_var))):
        check = ttk.Checkbutton(protected_row, text=label, variable=variable, command=self.on_rule_changed)
        check.grid(row=0, column=column, sticky='w', padx=(0, 12))
        self.runtime_controls.append((check, 'normal'))
    relic_grade_frame = ttk.Frame(corrosion_body, style='Panel.TFrame')
    relic_grade_frame.grid(row=4, column=0, columnspan=4, sticky='ew', pady=(2, 3))
    ttk.Label(relic_grade_frame, text='圣物保护品质', style='PanelMuted.TLabel').pack(side='left', padx=(0, 8))
    configured_relic_grades = self.cfg.get('corrosionRelicProtectedGrades', list(range(10)))
    configured_relic_grades = {safe_int(value, -1) for value in configured_relic_grades or []}
    self.corrosion_relic_grade_vars = {}
    for grade_value, grade_name in enumerate(('普通', '罕见', '稀有', '传说', '不朽', '至宝', '超凡', '天界', '神圣', '宇宙')):
        variable = tk.BooleanVar(value=grade_value in configured_relic_grades)
        self.corrosion_relic_grade_vars[grade_value] = variable
        check = ttk.Checkbutton(relic_grade_frame, text=grade_name, variable=variable, command=self.on_rule_changed)
        check.pack(side='left', padx=(0, 7))
        self.runtime_controls.append((check, 'normal'))
    self.corrosion_status_var = tk.StringVar(value='等待连接')
    resources_box, resources_body = card(magic, '账号资源监测', '按账号分别展示污染度、仓库占用与腐蚀触发状态。')
    resources_box.grid(row=2, column=0, sticky='ew', pady=(0, 12))
    synthesis_box.grid_configure(row=3)
    corrosion_box.grid_configure(row=4)
    resources_body.columnconfigure(0, weight=1)
    resource_header = ttk.Frame(resources_body, style='Panel.TFrame')
    resource_header.grid(row=0, column=0, sticky='ew', pady=(0, 7))
    ttk.Label(resource_header, text='自动刷新：30秒', style='PanelMuted.TLabel').pack(side='left')
    ttk.Button(resource_header, text='刷新账号资源', style='Utility.TButton',
        command=lambda: refresh_corrosion_status(True)).pack(side='right')
    resource_table = ttk.Frame(resources_body, style='Panel.TFrame')
    resource_table.grid(row=1, column=0, sticky='nsew')
    resource_table.columnconfigure(0, weight=1)
    columns = ('account', 'pollution', 'pollution_rule', 'warehouse', 'warehouse_rule', 'result', 'updated')
    self.corrosion_accounts_tree = ttk.Treeview(resource_table, columns=columns, show='headings',
        height=2, style='Stats.Treeview', selectmode='browse')
    for key, title, width, anchor in (
        ('account', '账号 / 进程', 180, 'w'), ('pollution', '污染度', 82, 'e'),
        ('pollution_rule', '污染触发线', 92, 'center'), ('warehouse', '仓库占用', 155, 'center'),
        ('warehouse_rule', '占用触发线', 95, 'center'), ('result', '检测结果', 190, 'w'),
        ('updated', '刷新时间', 88, 'center')):
        self.corrosion_accounts_tree.heading(key, text=title, anchor=anchor)
        self.corrosion_accounts_tree.column(key, width=width, minwidth=width-15, anchor=anchor,
            stretch=key in ('account', 'warehouse', 'result'))
    self.corrosion_accounts_tree.tag_configure('ready', foreground='#16834A')
    self.corrosion_accounts_tree.tag_configure('triggered', foreground='#B96B0A', background='#FFF8EC')
    self.corrosion_accounts_tree.tag_configure('waiting', foreground='#5C7695')
    self.corrosion_accounts_tree.tag_configure('error', foreground='#C83B4A', background='#FFF1F2')
    self.corrosion_accounts_tree.grid(row=0, column=0, sticky='nsew')
    resource_scroll = ttk.Scrollbar(resource_table, orient='vertical', command=self.corrosion_accounts_tree.yview)
    resource_scroll.grid(row=0, column=1, sticky='ns')
    resource_hscroll = ttk.Scrollbar(resource_table, orient='horizontal', command=self.corrosion_accounts_tree.xview)
    resource_hscroll.grid(row=1, column=0, sticky='ew')
    self.corrosion_accounts_tree.configure(yscrollcommand=resource_scroll.set,
        xscrollcommand=resource_hscroll.set)
    ttk.Label(resources_body, textvariable=self.corrosion_status_var, style='PanelMuted.TLabel',
        wraplength=900).grid(row=2, column=0, sticky='w', pady=(7, 0))
    render_corrosion_account_rows([])
    try:
        self.status_var.trace_add('write', lambda *_args: self.after(250,
            lambda: refresh_corrosion_status(True)))
    except Exception:
        pass
    self.sync_synthesis_grade_options()

    # Map / ticket challenges
    map_page = self._ui_page_contents['map']
    map_page.columnconfigure(0, weight=1)
    page_heading(map_page, '地图', '门票挑战优先；自动地图巡查会避开 Boss 与南瓜灯峡谷关卡')
    map_columns = ttk.Frame(map_page, style='TFrame')
    map_columns.grid(row=2, column=0, sticky='nsew')
    map_columns.columnconfigure(0, weight=1)
    map_columns.columnconfigure(1, weight=1)
    challenge_box, challenge_body = card(map_columns, '门票挑战与 Boss', '各类门票库存严格大于对应门槛时进入目标关卡；入场后由游戏持续战斗，助手不会重复提交挑战。')
    challenge_box.grid(row=0, column=0, sticky='nsew', padx=(0, 6), pady=(0, 12))
    self.auto_boss_var = tk.BooleanVar(value=bool(self.cfg.get('autoBoss', False)) if self.license_valid else False)
    self.auto_boss_switch = ttk.Checkbutton(challenge_body, text='启用灵魂石挑战 Boss', variable=self.auto_boss_var, command=self.apply_runtime_config)
    self.auto_boss_switch.pack(anchor='w', pady=3)
    self.runtime_controls.append((self.auto_boss_switch, 'normal'))
    self.auto_halloween_event_var = tk.BooleanVar(value=bool(self.cfg.get('autoHalloweenEvent', False)) if self.license_valid else False)
    self.auto_halloween_event_switch = ttk.Checkbutton(challenge_body, text='启用杰克入场券挑战南瓜灯峡谷', variable=self.auto_halloween_event_var, command=self.apply_runtime_config)
    self.auto_halloween_event_switch.pack(anchor='w', pady=3)
    self.runtime_controls.append((self.auto_halloween_event_switch, 'normal'))
    self.challenge_summary_var = tk.StringVar(value=challenge_targets_summary(normalize_challenge_targets(self.cfg.get('challengeTargets'), self.cfg.get('autoBossMinStones', 1))))
    ttk.Label(challenge_body, textvariable=self.challenge_summary_var, style='PanelMuted.TLabel', wraplength=500, justify='left').pack(anchor='w', pady=(7, 8))
    ttk.Button(challenge_body, text='分别设置门票数量  →', style='Utility.TButton', command=self.open_challenge_settings).pack(anchor='w')
    ticket_interval_row = ttk.Frame(challenge_body, style='Panel.TFrame')
    ticket_interval_row.pack(anchor='w', fill='x', pady=(9, 0))
    ttk.Label(ticket_interval_row, text='门票检测间隔（分钟）', style='PanelMuted.TLabel').pack(side='left', padx=(0, 7))
    self.ticket_check_interval_var = tk.StringVar(value=str(self.cfg.get('bossTicketCheckIntervalMinutes', 1)))
    self.ticket_check_interval_spin = ttk.Spinbox(ticket_interval_row, from_=1, to=1440, width=6, textvariable=self.ticket_check_interval_var, command=self.on_rule_changed)
    self.ticket_check_interval_spin.pack(side='left')
    self.ticket_check_interval_spin.bind('<Return>', lambda _event: self.on_rule_changed())
    self.ticket_check_interval_spin.bind('<FocusOut>', lambda _event: self.on_rule_changed())
    self.runtime_controls.append((self.ticket_check_interval_spin, 'normal'))
    map_gap_row = ttk.Frame(challenge_body, style='Panel.TFrame')
    map_gap_row.pack(anchor='w', fill='x', pady=(8, 0))
    ttk.Label(map_gap_row, text='地图跳转安全间隔（秒）', style='PanelMuted.TLabel').pack(side='left', padx=(0, 7))
    self.map_switch_interval_var = tk.StringVar(value=str(self.cfg.get('mapSwitchMinimumIntervalSeconds', 10)))
    self.map_switch_interval_spin = ttk.Spinbox(map_gap_row, from_=2, to=3600, width=6,
        textvariable=self.map_switch_interval_var, command=self.on_rule_changed)
    self.map_switch_interval_spin.pack(side='left')
    self.map_switch_interval_spin.bind('<Return>', lambda _event: self.on_rule_changed())
    self.map_switch_interval_spin.bind('<FocusOut>', lambda _event: self.on_rule_changed())
    self.runtime_controls.append((self.map_switch_interval_spin, 'normal'))

    plague_box, plague_body = card(map_columns, '瘟疫之地自动前往', '每隔设定时间检查地图；Boss 与南瓜灯峡谷期间不会打断当前挑战。')
    plague_box.grid(row=0, column=1, sticky='nsew', padx=(6, 0), pady=(0, 12))
    self.auto_plague_map_var = tk.BooleanVar(value=bool(self.cfg.get('autoPlagueMapEnabled', False)) if self.license_valid else False)
    self.auto_plague_map_switch = ttk.Checkbutton(plague_body, text='启用自动前往瘟疫之地',
        variable=self.auto_plague_map_var, command=self.apply_runtime_config)
    self.auto_plague_map_switch.pack(anchor='w', pady=(2, 8))
    self.runtime_controls.append((self.auto_plague_map_switch, 'normal'))
    plague_target_row = ttk.Frame(plague_body, style='Panel.TFrame')
    plague_target_row.pack(anchor='w', fill='x', pady=3)
    ttk.Label(plague_target_row, text='难度', style='PanelMuted.TLabel').pack(side='left', padx=(0, 7))
    plague_difficulty_names = {1: '噩梦', 2: '地狱', 3: '折磨'}
    current_plague_difficulty = max(1, min(3, safe_int(self.cfg.get('autoPlagueDifficulty'), 3)))
    self.auto_plague_difficulty_var = tk.StringVar(value=plague_difficulty_names[current_plague_difficulty])
    self.auto_plague_difficulty_combo = ttk.Combobox(plague_target_row, state='readonly', width=8,
        values=('地狱', '噩梦', '折磨'), textvariable=self.auto_plague_difficulty_var)
    self.auto_plague_difficulty_combo.pack(side='left', padx=(0, 12))
    self.auto_plague_difficulty_combo.bind('<<ComboboxSelected>>', lambda _event: self.on_rule_changed())
    ttk.Label(plague_target_row, text='层数', style='PanelMuted.TLabel').pack(side='left', padx=(0, 7))
    self.auto_plague_stage_var = tk.StringVar(value=str(max(1, min(20, safe_int(self.cfg.get('autoPlagueStageNo'), 1)))))
    self.auto_plague_stage_spin = ttk.Spinbox(plague_target_row, from_=1, to=20, width=5,
        textvariable=self.auto_plague_stage_var, command=self.on_rule_changed)
    self.auto_plague_stage_spin.pack(side='left')
    self.auto_plague_stage_spin.bind('<Return>', lambda _event: self.on_rule_changed())
    self.auto_plague_stage_spin.bind('<FocusOut>', lambda _event: self.on_rule_changed())
    self.runtime_controls.extend(((self.auto_plague_difficulty_combo, 'readonly'), (self.auto_plague_stage_spin, 'normal')))
    plague_interval_row = ttk.Frame(plague_body, style='Panel.TFrame')
    plague_interval_row.pack(anchor='w', fill='x', pady=(7, 0))
    ttk.Label(plague_interval_row, text='地图检测间隔（分钟）', style='PanelMuted.TLabel').pack(side='left', padx=(0, 7))
    self.auto_plague_interval_var = tk.StringVar(value=str(self.cfg.get('autoPlagueCheckIntervalMinutes', 1)))
    self.auto_plague_interval_spin = ttk.Spinbox(plague_interval_row, from_=1, to=1440, width=6,
        textvariable=self.auto_plague_interval_var, command=self.on_rule_changed)
    self.auto_plague_interval_spin.pack(side='left')
    self.auto_plague_interval_spin.bind('<Return>', lambda _event: self.on_rule_changed())
    self.auto_plague_interval_spin.bind('<FocusOut>', lambda _event: self.on_rule_changed())
    self.runtime_controls.append((self.auto_plague_interval_spin, 'normal'))

    preview_page = self._ui_page_contents['drop_preview']
    preview_page.columnconfigure(0, weight=1)
    page_heading(preview_page, '掉落预览', '查看当前游戏关卡的待掉落队列与价格巡查；保留原有预览逻辑。')
    ttk.Label(preview_page, text='暂不可用 · 当前版本未适配游戏掉落接口，以下预览内容仅供查看。',
        foreground='#C83B4A', background='#FFF1F2', anchor='w',
        font=('Microsoft YaHei UI', 11, 'bold'), padding=(10, 7)).grid(
            row=2, column=0, sticky='ew', pady=(0, 12))
    preview_controls_box, preview_controls = card(preview_page, '预览控制', '开启后在连接的游戏实例中读取后续掉落数据。')
    preview_controls_box.grid(row=3, column=0, sticky='ew', pady=(0, 12))
    self.drop_preview_var = tk.BooleanVar(value=bool(self.cfg.get('showDropPreview', False)))
    self.drop_preview_switch = ttk.Checkbutton(preview_controls, text='启用后续掉落预览', variable=self.drop_preview_var, command=self.toggle_drop_preview)
    self.drop_preview_switch.pack(anchor='w', pady=3)
    self.runtime_controls.append((self.drop_preview_switch, 'normal'))
    ttk.Button(preview_controls, text='查看当前游戏状态', style='Utility.TButton', command=self.show_status).pack(anchor='w', pady=(5, 0))
    preview_shell, preview_body = card(preview_page, '后续掉落与价格巡查', padding=(10, 8))
    preview_shell.grid(row=4, column=0, sticky='ew', pady=(0, 12))
    preview_body.columnconfigure(0, weight=1)
    self._build_drop_preview_panel(parent=preview_body)
    try:
        self.drop_preview_panel.configure(width=760)
        self.drop_preview_panel.grid_propagate(True)
    except Exception:
        pass
    self._dashboard_sections.extend((map_columns, preview_controls_box, preview_shell))

    # Warehouse / trade ship
    warehouse = self._ui_page_contents['warehouse']
    warehouse.columnconfigure(0, weight=1)
    page_heading(warehouse, '仓库', '按账号查看仓库物品、查询报价并管理游戏交易船')
    warehouse_cards = ttk.Frame(warehouse, style='TFrame')
    warehouse_cards.grid(row=2, column=0, sticky='ew')
    for column in range(2):
        warehouse_cards.columnconfigure(column, weight=1, uniform='warehouse')
    stash_box, stash_body = card(warehouse_cards, '自动存仓', '按设定间隔，将背包物品逐件存入有空位的仓库页。')
    stash_box.grid(row=0, column=0, sticky='nsew', padx=(0, 6), pady=(0, 12))
    ttk.Checkbutton(stash_body, text='自动存放背包物品', variable=self.auto_deposit_unsynthable_var, command=self.apply_runtime_config).pack(anchor='w', pady=(4, 7))
    deposit_interval_row = ttk.Frame(stash_body, style='Panel.TFrame')
    deposit_interval_row.pack(anchor='w', fill='x', pady=(0, 7))
    ttk.Label(deposit_interval_row, text='存仓间隔（分钟）', style='PanelMuted.TLabel').pack(side='left', padx=(0, 7))
    self.auto_deposit_interval_var = tk.StringVar(value=str(self.cfg.get('autoDepositIntervalMinutes', 10)))
    self.auto_deposit_interval_spin = ttk.Spinbox(deposit_interval_row, from_=1, to=1440, width=6, textvariable=self.auto_deposit_interval_var, command=self.on_rule_changed)
    self.auto_deposit_interval_spin.pack(side='left')
    self.auto_deposit_interval_spin.bind('<Return>', lambda _event: self.on_rule_changed())
    self.auto_deposit_interval_spin.bind('<FocusOut>', lambda _event: self.on_rule_changed())
    self.runtime_controls.append((self.auto_deposit_interval_spin, 'normal'))
    trade_box, trade_body = card(warehouse_cards, '交易船', '查询参考价格并将符合条件的物品转入游戏内交易船。')
    trade_box.grid(row=0, column=1, sticky='nsew', padx=(6, 0), pady=(0, 12))
    self.auto_trade_ship_var = tk.BooleanVar(value=bool(self.cfg.get('autoTradeShip', False)) if self.license_valid else False)
    self.auto_trade_ship_switch = ttk.Checkbutton(trade_body, text='自动转入游戏交易船', variable=self.auto_trade_ship_var, command=self.apply_runtime_config)
    self.auto_trade_ship_switch.pack(anchor='w', pady=(4, 8))
    self.runtime_controls.append((self.auto_trade_ship_switch, 'normal'))
    trade_interval_row = ttk.Frame(trade_body, style='Panel.TFrame')
    trade_interval_row.pack(fill='x', pady=(0, 6))
    ttk.Label(trade_interval_row, text='自动检测间隔（分钟）', style='PanelMuted.TLabel').pack(side='left', padx=(0, 7))
    self.auto_trade_ship_interval_var = tk.StringVar(value=str(self.cfg.get('autoTradeShipIntervalMinutes', 1)))
    self.auto_trade_ship_interval_spin = ttk.Spinbox(trade_interval_row, from_=1, to=1440, width=5,
        textvariable=self.auto_trade_ship_interval_var, command=self.on_rule_changed)
    self.auto_trade_ship_interval_spin.pack(side='left', padx=(0, 8))
    self.auto_trade_ship_interval_spin.bind('<Return>', lambda _event: self.on_rule_changed())
    self.auto_trade_ship_interval_spin.bind('<FocusOut>', lambda _event: self.on_rule_changed())
    self.runtime_controls.append((self.auto_trade_ship_interval_spin, 'normal'))
    self.manual_trade_ship_button = ttk.Button(trade_interval_row, text='立即转入一轮', style='Accent.TButton',
        command=manual_trade_ship_round)
    self.manual_trade_ship_button.pack(side='left')
    self.runtime_controls.append((self.manual_trade_ship_button, 'normal'))
    trade_price_row = ttk.Frame(trade_body, style='Panel.TFrame')
    trade_price_row.pack(fill='x', pady=(0, 3))
    ttk.Label(trade_price_row, text='规则', style='PanelMuted.TLabel').pack(side='left', padx=(0, 6))
    self.auto_trade_ship_price_mode_var = tk.StringVar(value=(
        '最高价优先' if self.cfg.get('autoTradeShipPriceMode') == 'highest' else '价格区间'))
    self.auto_trade_ship_price_mode_combo = ttk.Combobox(trade_price_row, state='readonly', width=10,
        values=('价格区间', '最高价优先'), textvariable=self.auto_trade_ship_price_mode_var)
    self.auto_trade_ship_price_mode_combo.pack(side='left', padx=(0, 8))
    self.auto_trade_ship_price_mode_combo.bind('<<ComboboxSelected>>', lambda _event: self.on_rule_changed())
    self.runtime_controls.append((self.auto_trade_ship_price_mode_combo, 'readonly'))
    ttk.Label(trade_price_row, text='最低 ¥', style='PanelMuted.TLabel').pack(side='left', padx=(0, 4))
    self.auto_trade_ship_min_price_var = tk.StringVar(value=f'{normalize_nonnegative_float(self.cfg.get("autoTradeShipMinPriceCny"), 1.0):g}')
    self.auto_trade_ship_min_price_entry = ttk.Entry(trade_price_row, textvariable=self.auto_trade_ship_min_price_var, width=7)
    self.auto_trade_ship_min_price_entry.pack(side='left', padx=(0, 7))
    self.auto_trade_ship_min_price_entry.bind('<Return>', lambda _event: self.on_rule_changed())
    self.auto_trade_ship_min_price_entry.bind('<FocusOut>', lambda _event: self.on_rule_changed())
    self.runtime_controls.append((self.auto_trade_ship_min_price_entry, 'normal'))
    ttk.Label(trade_price_row, text='最高 ¥', style='PanelMuted.TLabel').pack(side='left', padx=(0, 4))
    self.auto_trade_ship_max_price_var = tk.StringVar(value=f'{normalize_nonnegative_float(self.cfg.get("autoTradeShipMaxPriceCny"), 0.0):g}')
    self.auto_trade_ship_max_price_entry = ttk.Entry(trade_price_row, textvariable=self.auto_trade_ship_max_price_var, width=7)
    self.auto_trade_ship_max_price_entry.pack(side='left')
    self.auto_trade_ship_max_price_entry.bind('<Return>', lambda _event: self.on_rule_changed())
    self.auto_trade_ship_max_price_entry.bind('<FocusOut>', lambda _event: self.on_rule_changed())
    self.runtime_controls.append((self.auto_trade_ship_max_price_entry, 'normal'))
    ttk.Label(trade_body, text='区间模式按最低/最高价筛选（最高价填 0 表示不限）；最高价优先模式按报价从高到低，仍可设置最低价。冷却或暂不可交易物品会跳过，后续检测再试。',
        style='PanelMuted.TLabel', wraplength=520, justify='left').pack(anchor='w')
    ttk.Label(trade_body,text='游戏提示限时禁售时自动确认关闭，并按账号/物品记录解禁时间；到期前跳过，到期后恢复候选。',
        style='PanelMuted.TLabel',wraplength=520,justify='left').pack(anchor='w',pady=(5,0))
    inventory_box, inventory_body = card(warehouse, '仓库物品与市场价', '隐藏永久不可交易物品；可交易与限时禁售物品分卡显示，解禁时间为北京时间；报价与交易船共用缓存。')
    inventory_box.grid(row=3, column=0, sticky='ew', pady=(0, 12))
    inventory_body.columnconfigure(0, weight=1)
    warehouse_filters = ttk.Frame(inventory_body, style='Panel.TFrame')
    warehouse_filters.grid(row=0, column=0, sticky='ew', pady=(0, 7))
    for column, weight in enumerate((2, 2, 1, 1, 1, 0, 0)):
        warehouse_filters.columnconfigure(column, weight=weight)
    self.warehouse_account_var = tk.StringVar(value='全部账号')
    self.warehouse_account_combo = ttk.Combobox(warehouse_filters, textvariable=self.warehouse_account_var, state='readonly', width=24, values=('全部账号',))
    self.warehouse_account_combo.grid(row=0, column=0, sticky='ew', padx=(0, 6))
    self.warehouse_account_combo.bind('<<ComboboxSelected>>', lambda _event: refresh_warehouse(False))
    self.warehouse_search_var = tk.StringVar(value='')
    warehouse_search = ttk.Entry(warehouse_filters, textvariable=self.warehouse_search_var)
    warehouse_search.grid(row=0, column=1, sticky='ew', padx=(0, 6))
    warehouse_search.insert(0, '')
    self.warehouse_search_var.trace_add('write', lambda *_args: render_warehouse())
    self.warehouse_grade_var = tk.StringVar(value='全部品质')
    self.warehouse_grade_combo = ttk.Combobox(warehouse_filters, textvariable=self.warehouse_grade_var, state='readonly', width=12,
        values=('全部品质', '普通', '罕见', '稀有', '传说', '不朽', '至宝', '超凡', '天界', '神圣', '宇宙'))
    self.warehouse_grade_combo.grid(row=0, column=2, sticky='ew', padx=(0, 6))
    self.warehouse_grade_combo.bind('<<ComboboxSelected>>', lambda _event: render_warehouse())
    self.warehouse_type_var = tk.StringVar(value='全部类型')
    self.warehouse_type_combo = ttk.Combobox(warehouse_filters, textvariable=self.warehouse_type_var, state='readonly', width=10,
        values=('全部类型', '装备', '材料'))
    self.warehouse_type_combo.grid(row=0, column=3, sticky='ew', padx=(0, 6))
    self.warehouse_type_combo.bind('<<ComboboxSelected>>', lambda _event: render_warehouse())
    self.warehouse_order_var = tk.StringVar(value='品质降序')
    self.warehouse_order_combo = ttk.Combobox(warehouse_filters, textvariable=self.warehouse_order_var, state='readonly', width=12,
        values=('品质降序', '价格降序', '数量降序', '名称'))
    self.warehouse_order_combo.grid(row=0, column=4, sticky='ew', padx=(0, 6))
    self.warehouse_order_combo.bind('<<ComboboxSelected>>', lambda _event: render_warehouse())
    self.warehouse_refresh_button = ttk.Button(warehouse_filters, text='刷新仓库', style='Utility.TButton', command=lambda: refresh_warehouse(True))
    self.warehouse_refresh_button.grid(row=0, column=5, padx=(0, 5))
    self.warehouse_price_button = ttk.Button(warehouse_filters, text='查询报价', style='Accent.TButton', command=request_warehouse_prices)
    self.warehouse_price_button.grid(row=0, column=6)
    self.warehouse_status_var = tk.StringVar(value='连接游戏后读取仓库物品')
    ttk.Label(inventory_body, textvariable=self.warehouse_status_var, style='PanelMuted.TLabel').grid(row=1, column=0, sticky='ew', pady=(0, 6))
    self.warehouse_canvas = tk.Canvas(inventory_body, background='#FFFFFF', height=440,
        highlightthickness=1, highlightbackground=colors['border'], borderwidth=0, yscrollincrement=30)
    self.warehouse_canvas.grid(row=2, column=0, sticky='nsew')
    inventory_body.rowconfigure(2, weight=1)
    def warehouse_card_yview(*args):
        self.warehouse_canvas.yview(*args)
        schedule_warehouse_card_draw()
    warehouse_scroll = ttk.Scrollbar(inventory_body, orient='vertical', command=warehouse_card_yview)
    warehouse_scroll.grid(row=2, column=1, sticky='ns')
    self.warehouse_canvas.configure(yscrollcommand=warehouse_scroll.set)
    self.warehouse_canvas.bind('<Configure>', schedule_warehouse_card_draw)
    self.warehouse_canvas.bind('<MouseWheel>', warehouse_card_scroll)
    self.warehouse_canvas.bind('<Motion>', warehouse_card_hover)
    self.warehouse_canvas.bind('<Leave>', warehouse_card_leave)
    self.warehouse_canvas.bind('<Button-1>', warehouse_card_click)
    self.warehouse_detail_var = tk.StringVar(value='悬停查看完整名称、品质、数量与当前缓存报价')
    ttk.Label(inventory_body, textvariable=self.warehouse_detail_var, style='PanelMuted.TLabel',
        wraplength=1050).grid(row=3, column=0, columnspan=2, sticky='w', pady=(7, 0))
    self._ui_draw_warehouse_cards = draw_warehouse_cards
    self._ui_warehouse_item_photo = warehouse_item_photo
    self._ui_warehouse_card_yview = warehouse_card_yview
    self._dashboard_sections.extend((warehouse_cards, inventory_box))

    # Statistics page
    stats_page = self._ui_page_contents['stats']
    stats_page.columnconfigure(0, weight=1)
    page_heading(stats_page, '数据统计', '近24小时与累计宝箱数量；下方汇总游戏确认的掉落物品')
    self.stat_value_vars = {}
    stat_grid = ttk.Frame(stats_page, style='TFrame')
    stat_grid.grid(row=2, column=0, sticky='ew', pady=(0, 12))
    for column in range(2):
        stat_grid.columnconfigure(column, weight=1, uniform='stats')
    for column, (key, title) in enumerate((('24小时宝箱', '近24小时宝箱'), ('累计宝箱', '累计宝箱'))):
        box, body = card(stat_grid, title, padding=(15, 12))
        box.grid(row=0, column=column, sticky='nsew', padx=(0, 5) if column == 0 else (5, 0))
        value = tk.StringVar(value='0')
        self.stat_value_vars[key] = value
        ttk.Label(body, textvariable=value, style='CardValue.TLabel').pack(anchor='w', pady=(5, 1))
    stats_style = ttk.Style(self)
    self._stats_tab_images = []
    for background, underline in (('#FFFFFF', '#FFFFFF'), ('#EAF3F5', colors['accent'])):
        image = tk.PhotoImage(master=self, width=128, height=4)
        image.put(background, to=(0, 0, 128, 4))
        image.put(underline, to=(0, 2, 128, 4))
        self._stats_tab_images.append(image)
    stats_style.element_create('StatsTab.background', 'image', self._stats_tab_images[0],
        ('selected', self._stats_tab_images[1]), border=(0, 0, 0, 2), sticky='nsew')
    stats_style.layout('Stats.TNotebook', [('Notebook.client', {'sticky': 'nsew'})])
    stats_style.layout('Stats.TNotebook.Tab', [('StatsTab.background', {'sticky': 'nsew', 'children': [
        ('Notebook.padding', {'side': 'top', 'sticky': 'nsew', 'children': [
            ('Notebook.focus', {'side': 'top', 'sticky': 'nsew', 'children': [
                ('Notebook.label', {'side': 'top', 'sticky': ''})]})]})]})])
    stats_style.configure('Stats.TNotebook', tabmargins=(0, 0, 0, 0), borderwidth=0,
        background=colors['background'], bordercolor=colors['background'],
        lightcolor=colors['background'], darkcolor=colors['background'])
    tab_options = {'font': ('Microsoft YaHei UI', 10), 'padding': (16, 9)}
    self._ui_base_styles['Stats.TNotebook.Tab'] = dict(tab_options)
    stats_style.configure('Stats.TNotebook.Tab', **tab_options, foreground=colors['muted'])
    stats_style.map('Stats.TNotebook.Tab', expand=[('selected', (0, 0, 0, 0))],
        foreground=[('selected', colors['accent'])])
    self.stats_notebook = ttk.Notebook(stats_page, style='Stats.TNotebook')
    self.stats_notebook.grid(row=3, column=0, sticky='nsew', pady=(0, 12))
    self.stats_tabs = {}
    for key, title in (('probability', '掉落概率'), ('drops', '掉落记录'), ('rare', '珍品记录')):
        tab = ttk.Frame(self.stats_notebook, style='TFrame', padding=(0, 8, 0, 0))
        tab.columnconfigure(0, weight=1)
        tab.rowconfigure(0, weight=1)
        self.stats_notebook.add(tab, text=title)
        self.stats_tabs[key] = tab
    grade_summary_box, grade_summary_body = card(self.stats_tabs['probability'], '掉落品质汇总与概率',
        '各品质数量 ÷ 有效掉落总数 × 100%；灵魂石（含被污染的灵魂石）与合成产物不计入。概率为已记录样本占比。')
    grade_summary_box.grid(row=0, column=0, sticky='nsew')
    grade_summary_body.columnconfigure(0,weight=1)
    self.drop_grade_status_var=tk.StringVar(value='有效掉落总数：0 件')
    ttk.Label(grade_summary_body,textvariable=self.drop_grade_status_var,style='PanelMuted.TLabel',wraplength=960).grid(
        row=0,column=0,sticky='w',pady=(0,7))
    self.drop_grade_tree=ttk.Treeview(grade_summary_body,columns=('品质','掉落数量','概率'),
        show='headings',height=10,style='Stats.Treeview',selectmode='none')
    for column,width in (('品质',180),('掉落数量',180),('概率',200)):
        self.drop_grade_tree.heading(column,text=column)
        self.drop_grade_tree.column(column,width=width,minwidth=90,anchor='center')
    self.drop_grade_tree.grid(row=1,column=0,sticky='ew')
    drop_records_box, drop_records_body = card(self.stats_tabs['drops'], '掉落记录',
        '来自游戏确认的实际掉落；相同物品叠加数量，显示最近掉落时间与地图。灵魂石保留明细。')
    drop_records_box.grid(row=0, column=0, sticky='nsew')
    drop_records_body.columnconfigure(0, weight=1)
    drop_records_body.rowconfigure(1, weight=1)
    self.drop_records_status_var = tk.StringVar(value='等待游戏掉落数据')
    ttk.Label(drop_records_body, textvariable=self.drop_records_status_var, style='PanelMuted.TLabel', wraplength=960).grid(row=0, column=0, columnspan=2, sticky='ew', pady=(0, 6))
    drop_columns = ('品质', '物品', '数量', '最近地图', '最近掉落')
    self.drop_records_tree = ttk.Treeview(drop_records_body, columns=drop_columns, show='headings', height=10, style='Stats.Treeview')
    for column, width in zip(drop_columns, (90, 300, 75, 180, 190)):
        self.drop_records_tree.heading(column, text=column)
        self.drop_records_tree.column(column, width=width, minwidth=60, stretch=column == '物品')
    self.drop_records_tree.grid(row=1, column=0, sticky='nsew')
    drop_scroll = ttk.Scrollbar(drop_records_body, orient='vertical', command=self.drop_records_tree.yview)
    drop_scroll.grid(row=1, column=1, sticky='ns')
    drop_xscroll = ttk.Scrollbar(drop_records_body, orient='horizontal', command=self.drop_records_tree.xview)
    drop_xscroll.grid(row=2, column=0, sticky='ew')
    self.drop_records_tree.configure(yscrollcommand=drop_scroll.set, xscrollcommand=drop_xscroll.set)
    self.drop_records_tree.tag_configure('drop_grade_common', foreground=GRADE_COLORS.get('普通', '#7D7D7D'))
    configure_grade_tags(self.drop_records_tree)
    rare_box, rare_body = card(self.stats_tabs['rare'], '珍品掉落记录',
        '超凡、天界、神圣、宇宙掉落时额外保存一份；相同物品叠加数量，并显示最近掉落时间与地图。')
    rare_box.grid(row=0, column=0, sticky='nsew')
    rare_body.columnconfigure(0, weight=1)
    rare_body.rowconfigure(1, weight=1)
    self.rare_drop_status_var = tk.StringVar(value='珍品累计 0 件')
    ttk.Label(rare_body, textvariable=self.rare_drop_status_var, style='PanelMuted.TLabel',
        wraplength=960).grid(row=0, column=0, columnspan=2, sticky='ew', pady=(0, 6))
    rare_columns = ('品质', '物品', '数量', '最近地图', '最近掉落')
    self.rare_drop_tree = ttk.Treeview(rare_body, columns=rare_columns, show='headings',
        height=10, style='Stats.Treeview')
    for column, width in zip(rare_columns, (90, 300, 75, 180, 190)):
        self.rare_drop_tree.heading(column, text=column)
        self.rare_drop_tree.column(column, width=width, minwidth=60, stretch=column == '物品')
    self.rare_drop_tree.grid(row=1, column=0, sticky='nsew')
    rare_scroll = ttk.Scrollbar(rare_body, orient='vertical', command=self.rare_drop_tree.yview)
    rare_scroll.grid(row=1, column=1, sticky='ns')
    rare_xscroll = ttk.Scrollbar(rare_body, orient='horizontal', command=self.rare_drop_tree.xview)
    rare_xscroll.grid(row=2, column=0, sticky='ew')
    self.rare_drop_tree.configure(yscrollcommand=rare_scroll.set, xscrollcommand=rare_xscroll.set)
    configure_grade_tags(self.rare_drop_tree)
    for grade, color in dict(GRADE_COLORS, 传说=GRADE_COLORS.get('传奇', '#B87230')).items():
        self.rare_drop_tree.tag_configure(f'drop_grade_{grade}', foreground=color)
    refresh_box_counts()
    self._dashboard_sections.extend((stat_grid, self.stats_notebook, grade_summary_box, drop_records_box, rare_box))

    # Logs page
    logs_page = self._ui_page_contents['logs']
    logs_page.columnconfigure(0, weight=1)
    logs_page.rowconfigure(3, weight=1)
    page_heading(logs_page, '运行日志', '连接、合成、开箱、腐蚀与挑战任务记录')
    log_tools = ttk.Frame(logs_page, style='TFrame')
    log_tools.grid(row=2, column=0, sticky='ew', pady=(0, 8))
    self.diagnostic_logs_button = ttk.Button(log_tools, text='打开诊断日志目录', style='Utility.TButton', command=self.open_diagnostic_log_folder)
    self.diagnostic_logs_button.pack(side='left')
    ttk.Button(log_tools, text='查看文件日志说明', style='Utility.TButton', command=self.open_log_dir).pack(side='left', padx=7)
    log_card, log_body = card(logs_page, '活动记录', padding=(8, 8))
    log_card.grid(row=3, column=0, sticky='nsew', pady=(0, 8))
    log_body.columnconfigure(0, weight=1)
    log_body.rowconfigure(0, weight=1)
    self.log_text = tk.Text(log_body, wrap='word', state='disabled', background=colors['field'], foreground=colors['text'], insertbackground=colors['accent'], selectbackground='#DDECF1', borderwidth=0, highlightthickness=0, padx=12, pady=8, font=('Cascadia Mono', 9), spacing1=1, spacing2=1, spacing3=1, height=18)
    self.log_text.grid(row=0, column=0, sticky='nsew')
    configure_grade_tags(self.log_text)
    log_scroll = ttk.Scrollbar(log_body, orient='vertical', command=self.log_text.yview)
    log_scroll.grid(row=0, column=1, sticky='ns')
    self.log_text.configure(yscrollcommand=log_scroll.set)

    # Settings page
    settings = self._ui_page_contents['settings']
    settings.columnconfigure(0, weight=1)
    page_heading(settings, '设置 / setting', '程序配置、连接策略与本地文件')
    settings_box, settings_body = card(settings, '连接设置', '选项变更会保存到本地配置文件。')
    settings_box.grid(row=2, column=0, sticky='ew', pady=(0, 12))
    ttk.Checkbutton(settings_body, text='自动连接发现的游戏进程', variable=self.auto_attach_var, command=self.on_auto_attach_changed).pack(anchor='w', pady=3)
    ttk.Checkbutton(settings_body, text='游戏异常退出后自动重启', variable=self.auto_restart_game_var, command=self.on_auto_restart_changed).pack(anchor='w', pady=3)
    ttk.Checkbutton(settings_body, text='一键开启宿主机游戏', variable=self.auto_start_host_var, command=self.on_auto_start_options_changed).pack(anchor='w', pady=3)
    ttk.Checkbutton(settings_body, text='一键开启所选沙盒实例', variable=self.auto_start_sandbox_var, command=self.on_auto_start_options_changed).pack(anchor='w', pady=3)
    config_box, config_body = card(settings, '配置文件', '查看、重新加载或恢复默认设置。')
    config_box.grid(row=3, column=0, sticky='ew', pady=(0, 12))
    ttk.Button(config_body, text='打开配置文件', style='Utility.TButton', command=self.open_config_file).pack(side='left')
    ttk.Button(config_body, text='重新加载', style='Utility.TButton', command=self.reload_config).pack(side='left', padx=7)
    ttk.Button(config_body, text='恢复默认配置', style='Danger.TButton', command=self.reset_default_config).pack(side='left', padx=7)
    update_box, update_body = card(settings, '版本更新', '启动时与每 12 小时检测 GitHub 发布页。')
    update_box.grid(row=4, column=0, sticky='ew', pady=(0, 12))
    self.auto_update_check_var = tk.BooleanVar(value=self.cfg.get('autoUpdateCheck', True) is not False)
    ttk.Checkbutton(update_body, text='自动检测新版本（每 12 小时）',
        variable=self.auto_update_check_var,
        command=lambda: self.set_auto_update_check(self.auto_update_check_var.get())).pack(anchor='w', pady=(0, 8))
    update_actions = ttk.Frame(update_body, style='Panel.TFrame')
    update_actions.pack(anchor='w')
    self.update_check_button = ttk.Button(update_actions, text='立即检测更新', style='Accent.TButton',
        command=lambda: self.check_github_update(manual=True))
    self.update_check_button.pack(side='left')
    ttk.Button(update_actions, text='打开发布页', style='Utility.TButton',
        command=lambda: self._open_external_link('https://github.com/buguniaoOVO/TBHHelper/releases/latest')).pack(side='left', padx=7)
    self.update_status_var = tk.StringVar(value='尚未检测')
    ttk.Label(update_body, textvariable=self.update_status_var, style='PanelMuted.TLabel',
        wraplength=1000).pack(anchor='w', pady=(8, 0))

    # Help page
    help_page = self._ui_page_contents['help']
    help_page.columnconfigure(0, weight=1)
    page_heading(help_page, '使用说明', '本地自动化工具')
    help_box, help_body = card(help_page, '快速使用', padding=(18, 16))
    help_box.grid(row=2, column=0, sticky='ew', pady=(0, 12))
    help_text = '1. 启动游戏后，在“账号”页连接本机或 Sandboxie 实例。\n2. 在“魔方”“地图”和“仓库”页分别设置功能与筛选规则。\n3. 点击“一键开启”启动选定游戏；已连接后，勾选项会按游戏进程应用。\n4. 在“日志”和“统计”页查看执行结果。'
    ttk.Label(help_body, text=help_text, style='PanelMuted.TLabel', justify='left', wraplength=1000).pack(anchor='w')
    legal_box, legal_body = card(help_page, '风险提示', padding=(18, 16))
    legal_box.grid(row=3, column=0, sticky='ew', pady=(0, 12))
    ttk.Label(legal_body, text='自动化操作可能受到游戏规则或平台限制。请阅读相关规则并自行评估账号风险。程序仅提供本地自动化能力，不保证游戏服务端接受每项操作。', style='PanelMuted.TLabel', wraplength=1000, justify='left').pack(anchor='w')
    ttk.Label(legal_body, text='TBH助手 · 免费使用   |   版本 ' + str(APP_VERSION), style='PanelMuted.TLabel').pack(anchor='w', pady=(10, 0))

    # Persist and broadcast the new time/warehouse-protection rules through the
    # existing Frida profile; the connection path remains process-scoped Frida.
    original_save_ui_config = self.save_ui_config
    original_apply_config_to_ui = self.apply_config_to_ui
    original_configure_market_prices = self.configure_market_price_service
    original_runtime_enabled = self.runtime_enabled
    previous_on_connected_callback = self.on_connected
    self._trade_ship_lock_config_lock = threading.RLock()
    self._trade_ship_deferred_path = APP_DIR / 'cache' / 'trade-ship-deferred.json'
    def normalize_trade_ship_deferred(values, now_ms=None):
        now_ms = int(time.time()*1000) if now_ms is None else now_ms
        rows = {}
        if not isinstance(values,(list,tuple)):
            return []
        for raw in values:
            if not isinstance(raw,dict):
                continue
            uid, account_key = str(raw.get('uid') or '').strip(), str(raw.get('accountKey') or '').strip()
            available_at = safe_int(raw.get('availableAt'),0)
            if not uid.isdigit() or uid=='0' or len(uid)>20 or available_at<=now_ms:
                continue
            if not ((account_key.startswith('steam:') and account_key[6:].isdigit() and 16<=len(account_key[6:])<=20)
                    or (account_key.startswith('process:') and account_key[8:].isdigit())):
                continue
            row={'accountKey':account_key,'uid':uid,'itemKey':safe_int(raw.get('itemKey'),0),
                 'availableAt':available_at,'observedAt':safe_int(raw.get('observedAt'),now_ms)}
            key=(account_key,uid)
            if key not in rows or rows[key]['availableAt']<available_at:
                rows[key]=row
        return sorted(rows.values(),key=lambda row:(row['accountKey'],len(row['uid']),row['uid']))

    def load_trade_ship_deferred():
        try:
            payload=json.loads(self._trade_ship_deferred_path.read_text(encoding='utf-8'))
            return normalize_trade_ship_deferred(payload.get('items') if isinstance(payload,dict) else [])
        except (OSError,ValueError,TypeError):
            return []

    def save_trade_ship_deferred(records):
        records=normalize_trade_ship_deferred(records)
        path=self._trade_ship_deferred_path
        path.parent.mkdir(parents=True,exist_ok=True)
        temporary=path.with_suffix('.json.tmp')
        temporary.write_text(json.dumps({'version':1,'items':records},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        temporary.replace(path)
        return records

    self.cfg['tradeShipDeferredItems']=normalize_trade_ship_deferred(
        list(self.cfg.get('tradeShipDeferredItems') or [])+load_trade_ship_deferred())
    original_backend_on_message = self.backend.on_message

    def persist_trade_ship_lock_event(pid, message, data):
        payload = message.get('payload') if isinstance(message, dict) else None
        if isinstance(payload,dict) and payload.get('type')=='auto_trade_ship_deferred':
            accepted=normalize_trade_ship_deferred([payload])
            if accepted:
                with self._trade_ship_lock_config_lock:
                    merged=normalize_trade_ship_deferred(load_trade_ship_deferred()+
                        list(self.cfg.get('tradeShipDeferredItems') or [])+accepted)
                    self.cfg['tradeShipDeferredItems']=merged
                    uid=accepted[0]['uid']
                    self.cfg['tradeShipLockedUids']=[value for value in self.cfg.get('tradeShipLockedUids') or [] if str(value)!=uid]
                    try:
                        save_trade_ship_deferred(merged)
                        # Remove only the superseded assistant lock; preserve other live settings.
                        latest=load_config()
                        previous_locks=normalize_trade_ship_locked_uids(latest.get('tradeShipLockedUids'))
                        if uid in previous_locks:
                            latest['tradeShipLockedUids']=[value for value in previous_locks if value!=uid]
                            save_config(latest)
                        file_log('trade-ship','item-deferred',{'pid':int(pid),'itemKey':accepted[0]['itemKey'],
                            'availableAt':accepted[0]['availableAt'],'count':len(merged)})
                    except OSError as exc:
                        file_log('trade-ship','item-deferred-save-failed',{'pid':int(pid),'error':str(exc)[:160]})
                try:
                    self.after(0,render_warehouse)
                except Exception:
                    pass
        if isinstance(payload, dict) and payload.get('type') == 'auto_trade_ship_locked':
            uid = str(payload.get('uid') or '').strip()
            if uid.isdigit() and uid != '0' and len(uid) <= 20:
                with self._trade_ship_lock_config_lock:
                    latest = {}
                    try:
                        if CONFIG_PATH.is_file():
                            loaded = json.loads(CONFIG_PATH.read_text(encoding='utf-8-sig'))
                            if isinstance(loaded, dict):
                                latest = loaded
                    except Exception:
                        latest = {}
                    merged = normalize_trade_ship_locked_uids(
                        list(latest.get('tradeShipLockedUids') or []) +
                        list((self.cfg or {}).get('tradeShipLockedUids') or []) + [uid])
                    latest['tradeShipLockedUids'] = merged
                    try:
                        save_config(latest)
                        self.cfg['tradeShipLockedUids'] = merged
                        file_log('trade-ship', 'item-locked', {
                            'pid': int(pid), 'uid': uid,
                            'itemKey': safe_int(payload.get('itemKey'), 0),
                            'lockType': 'assistant-managed', 'count': len(merged)})
                    except Exception as exc:
                        file_log('trade-ship', 'item-lock-save-failed', {
                            'pid': int(pid), 'uid': uid, 'error': str(exc)[:200]})
        return original_backend_on_message(pid, message, data)

    self.backend.on_message = persist_trade_ship_lock_event

    if not self._helper_single_instance_primary:
        def attach_async_single_instance_guard(*args, **kwargs):
            self.status_var.set('另一个 TBH助手 实例正在管理游戏进程')
            self.thread_log('检测到已有助手实例负责本机全部游戏进程；此窗口不会重复连接或发送自动化操作。')
            return None

        self.attach_async = attach_async_single_instance_guard
        try:
            self.after(500, lambda: self.thread_log(
                '检测到已有助手实例；请在主实例的“账号”页管理全部游戏进程。'))
        except Exception:
            pass

    def read_minutes(variable, fallback):
        try:
            return max(1, min(1440, int(str(variable.get()).strip())))
        except (TypeError, ValueError, tk.TclError):
            return fallback

    def save_ui_config_with_feature_rules():
        # Kept as a nested builder callback: it shares the original save path
        # and rewrites the extended automation fields before persisting.
        last_automation_settings = copy.deepcopy((self.cfg or {}).get('lastAutomationSettings') or {})
        trade_ship_locked_uids = normalize_trade_ship_locked_uids(
            list((self.cfg or {}).get('tradeShipLockedUids') or []) +
            list(load_config().get('tradeShipLockedUids') or []))
        with self._trade_ship_lock_config_lock:
            deferred_items=normalize_trade_ship_deferred(load_trade_ship_deferred()+
                list((self.cfg or {}).get('tradeShipDeferredItems') or []))
        timed_uids={row['uid'] for row in deferred_items}
        trade_ship_locked_uids=[uid for uid in trade_ship_locked_uids if uid not in timed_uids]
        cfg = original_save_ui_config()

        auto_update_check = (bool(self.auto_update_check_var.get())
            if getattr(self, 'auto_update_check_var', None) is not None else True)
        cfg.update({
            'lastAutomationSettings': last_automation_settings,
            'autoUpdateCheck': auto_update_check,
            'autoDepositAllItems': True,
            'extraDepositItemIds': [],
            'autoDepositIntervalMinutes': read_minutes(self.auto_deposit_interval_var, 10),
            'autoDepositCooldownMs': read_minutes(self.auto_deposit_interval_var, 10) * 60000,
            'autoBoxCheckIntervalMinutes': read_minutes(self.auto_box_interval_var, 1),
            'boxScanIntervalMs': read_minutes(self.auto_box_interval_var, 1) * 60000,
            'boxOpenDelayMs': 1800,
            'autoTradeShipIntervalMinutes': read_minutes(self.auto_trade_ship_interval_var, 1),
            'autoTradeShipIntervalMs': read_minutes(self.auto_trade_ship_interval_var, 1) * 60000,
            'autoTradeShipPriceMode': {'价格区间': 'range', '最高价优先': 'highest'}.get(
                self.auto_trade_ship_price_mode_var.get(), 'range'),
            'autoTradeShipMinPriceCny': normalize_nonnegative_float(
                self.auto_trade_ship_min_price_var.get(), 1.0),
            'autoTradeShipMaxPriceCny': normalize_nonnegative_float(
                self.auto_trade_ship_max_price_var.get(), 0.0),
            'tradeShipLockedUids': trade_ship_locked_uids,
            'tradeShipDeferredItems': deferred_items,
            'bossTicketCheckIntervalMinutes': read_minutes(self.ticket_check_interval_var, 1),
            'bossTicketCheckIntervalMs': read_minutes(self.ticket_check_interval_var, 1) * 60000,
            'mapSwitchMinimumIntervalSeconds': max(2, min(3600, safe_int(self.map_switch_interval_var.get(), 10))),
            'autoPlagueMapEnabled': self.auto_plague_map_var.get() is True,
            'autoPlagueDifficulty': {'噩梦': 1, '地狱': 2, '折磨': 3}.get(self.auto_plague_difficulty_var.get(), 3),
            'autoPlagueStageNo': max(1, min(20, safe_int(self.auto_plague_stage_var.get(), 1))),
            'autoPlagueCheckIntervalMinutes': read_minutes(self.auto_plague_interval_var, 1),
            'autoPlagueCheckIntervalMs': read_minutes(self.auto_plague_interval_var, 1) * 60000,
            'corrosionMinimumIntervalMinutes': read_minutes(self.corrosion_interval_var, 5),
            'corrosionMinimumIntervalMs': read_minutes(self.corrosion_interval_var, 5) * 60000,
            'corrosionWarehouseThresholdPercent': max(1, min(100, safe_int(self.corrosion_warehouse_threshold_var.get(), 50))),
            'corrosionPollutionThreshold': max(0, min(1000000, safe_int(self.corrosion_pollution_threshold_var.get(), 300))),
            'corrosionProtectOfferingMaterials': self.corrosion_protect_offering_var.get() is True,
            'corrosionProtectSoulstones': self.corrosion_protect_soulstones_var.get() is True,
            'corrosionProtectJackTickets': self.corrosion_protect_jack_var.get() is True,
            'corrosionProtectRelics': self.corrosion_protect_relics_var.get() is True,
            'corrosionRelicProtectedGrades': sorted(grade for grade, variable in self.corrosion_relic_grade_vars.items() if variable.get()),
            'corrosionExcludeOfferingCoins': self.corrosion_protect_offering_var.get() is True,
            'corrosionProtectedGrades': [],
            'instantKill': False,
            'godMode': False,
            'waveLock': False,
            'memoryClean': False,
        })
        self.cfg = cfg
        save_config(cfg)
        return cfg

    def apply_config_to_ui_with_feature_rules(cfg):
        result = original_apply_config_to_ui(cfg)
        self.auto_update_check_var.set(self.cfg.get('autoUpdateCheck', True) is not False)
        self.auto_deposit_interval_var.set(str(self.cfg.get('autoDepositIntervalMinutes', 10)))
        self.auto_box_interval_var.set(str(self.cfg.get('autoBoxCheckIntervalMinutes', 1)))
        self.auto_trade_ship_interval_var.set(str(self.cfg.get('autoTradeShipIntervalMinutes', 1)))
        self.auto_trade_ship_price_mode_var.set('最高价优先' if self.cfg.get('autoTradeShipPriceMode') == 'highest' else '价格区间')
        self.auto_trade_ship_min_price_var.set(str(normalize_nonnegative_float(self.cfg.get('autoTradeShipMinPriceCny'), 1.0)))
        self.auto_trade_ship_max_price_var.set(str(normalize_nonnegative_float(self.cfg.get('autoTradeShipMaxPriceCny'), 0.0)))
        self.ticket_check_interval_var.set(str(self.cfg.get('bossTicketCheckIntervalMinutes', 1)))
        self.map_switch_interval_var.set(str(self.cfg.get('mapSwitchMinimumIntervalSeconds', 10)))
        self.auto_plague_map_var.set(bool(self.cfg.get('autoPlagueMapEnabled', False)))
        self.auto_plague_difficulty_var.set({1: '噩梦', 2: '地狱', 3: '折磨'}.get(
            max(1, min(3, safe_int(self.cfg.get('autoPlagueDifficulty'), 3))), '折磨'))
        self.auto_plague_stage_var.set(str(max(1, min(20, safe_int(self.cfg.get('autoPlagueStageNo'), 1)))))
        self.auto_plague_interval_var.set(str(self.cfg.get('autoPlagueCheckIntervalMinutes', 1)))
        self.corrosion_interval_var.set(str(self.cfg.get('corrosionMinimumIntervalMinutes', 5)))
        self.corrosion_warehouse_threshold_var.set(str(self.cfg.get('corrosionWarehouseThresholdPercent', 50)))
        self.corrosion_pollution_threshold_var.set(str(max(0, min(1000000, safe_int(self.cfg.get('corrosionPollutionThreshold'), 300)))))
        self.corrosion_protect_offering_var.set(self.cfg.get('corrosionProtectOfferingMaterials') is not False)
        self.corrosion_protect_soulstones_var.set(self.cfg.get('corrosionProtectSoulstones') is not False)
        self.corrosion_protect_jack_var.set(self.cfg.get('corrosionProtectJackTickets') is not False)
        self.corrosion_protect_relics_var.set(self.cfg.get('corrosionProtectRelics') is not False)
        grades = {safe_int(value, -1) for value in self.cfg.get('corrosionRelicProtectedGrades', list(range(10))) or []}
        for grade, variable in self.corrosion_relic_grade_vars.items():
            variable.set(grade in grades)
        refresh_box_counts()
        refresh_warehouse_accounts()
        return result

    def configure_market_prices_with_warehouse(cfg=None):
        result = original_configure_market_prices(cfg)
        if self._warehouse_price_query_enabled:
            self.market_price_service.set_enabled(True)
        return result

    def on_connected_with_corrosion_status_probe(summary=None, quiet=False):
        result = previous_on_connected_callback(summary, quiet)
        try:
            self.after(500, lambda: refresh_corrosion_status(True))
        except Exception:
            pass
        return result

    self.save_ui_config = save_ui_config_with_feature_rules
    self.apply_config_to_ui = apply_config_to_ui_with_feature_rules
    self.configure_market_price_service = configure_market_prices_with_warehouse
    self.on_connected = on_connected_with_corrosion_status_probe
    self.runtime_enabled = lambda cfg=None: bool(original_runtime_enabled(cfg) or
        (cfg or self.cfg).get('autoPlagueMapEnabled') or (cfg or self.cfg).get('showDropPreview'))
    self.refresh_history_summary = request_statistics_refresh
    self.add_activity_record = add_box_count_record
    self._ui_refresh_drop_statistics = refresh_box_counts
    self._ui_refresh_warehouse_accounts = refresh_warehouse_accounts
    self._ui_refresh_warehouse = refresh_warehouse
    self._ui_render_warehouse = render_warehouse
    self.initialize_steam_seller_background = lambda: None
    self.ensure_steam_seller_panel = lambda start_hidden=False: None
    self.open_steam_seller = lambda: None
    self.queue_steam_sale_event = lambda event: None

    # Prefer TBHIndex; unresolved candidate IDs fall back to Steam Market.
    # A successful hourly refresh replaces the complete cache; failed refreshes
    # keep the last successful data visible and usable for display.
    price_service = self.market_price_service
    # v4 marks the API/FX-fallback path so an empty or stale v3 cache is not
    # mistaken for a successful refresh.
    price_service.MODEL = 'tbhindex-market-cny-v4'
    price_service._requested_item_ids = set()
    price_service._index_retry_after = 0.0
    price_service._steam_retry_after = 0.0
    original_fetch_prices = price_service._fetch_batch
    original_currency_profile = price_service._currency_profile
    original_price_update_handler = price_service.on_update
    original_load_disk_cache = price_service._load_disk_cache
    price_service._currency_profile_fallback_logged = False
    price_service._currency_profile_retry_at = 0.0

    def currency_profile_with_fx_fallback():
        fallback = {'offset': 0.0, 'tick': 0.01, 'rateAdj': 1.0}
        if time.time() < float(price_service._currency_profile_retry_at or 0):
            return fallback
        try:
            return original_currency_profile()
        except Exception as exc:
            price_service._currency_profile_retry_at = time.time() + MARKET_PRICE_MAX_AGE_SECONDS
            if not price_service._currency_profile_fallback_logged:
                price_service._currency_profile_fallback_logged = True
                self.thread_log('[市场报价] TBH Index 币种配置页暂不可读；改用实时汇率并按 ¥0.01 取整。')
            return fallback

    def load_price_cache_without_expiry():
        if getattr(price_service, 'cache_loaded', False):
            return
        price_service.cache_loaded = True
        try:
            payload = json.loads(price_service.cache_path.read_text(encoding='utf-8'))
            if payload.get('priceModel') != price_service.MODEL or not isinstance(payload.get('items'), dict):
                return
            with price_service.lock:
                price_service.cache = payload['items']
                price_service.refresh_at = float(payload.get('updatedAt') or 0)
        except (OSError, ValueError, TypeError, AttributeError):
            return

    def prices_for_cache(item_ids):
        load_price_cache_without_expiry()
        result = {}
        with price_service.lock:
            for raw_id in item_ids or []:
                item_id = str(raw_id)
                row = price_service.cache.get(item_id)
                result[item_id] = dict(row) if isinstance(row, dict) else {'resolved': False, 'priceCny': 0}
        return result

    price_service._load_disk_cache = load_price_cache_without_expiry
    price_service.prices_for = prices_for_cache
    price_service._currency_profile = currency_profile_with_fx_fallback
    price_service._manual_refresh_requested = False

    def price_update_with_warehouse_refresh(payload_json, payload):
        original_price_update_handler(payload_json, payload)
        if not getattr(self, 'shutting_down', False):
            try:
                self.after(0, render_warehouse)
            except Exception:
                pass

    price_service.on_update = price_update_with_warehouse_refresh

    def request_prices_with_queue(item_ids, force=False):
        try:
            price_service._load_disk_cache()
        except Exception:
            pass
        now = time.time()
        queued = set()
        with price_service.lock:
            for raw_id in item_ids or []:
                item_id = str(raw_id)
                if not item_id.isdigit() or int(item_id) <= 0:
                    continue
                cached = price_service.cache.get(item_id) or {}
                updated = float(cached.get('updatedAt') or 0)
                retry_after = float(cached.get('retryAfter') or 0)
                if not force and cached.get('resolved') is True and now - updated < MARKET_PRICE_MAX_AGE_SECONDS:
                    continue
                if not force and retry_after > now:
                    continue
                queued.add(item_id)
            price_service._requested_item_ids.update(queued)
        if queued or force:
            price_service.set_enabled(True)
            if force:
                price_service._manual_refresh_requested = True
                price_service.retry_at = 0
                price_service._index_retry_after = 0
                price_service._steam_retry_after = 0
            price_service.refresh_requested = True
            price_service.wake_event.set()
        return len(queued) if not force else len(set(str(value) for value in item_ids or []))

    def fetch_prices_with_steam_fallback():
        now = time.time()
        if now >= float(price_service._index_retry_after or 0):
            try:
                payload = original_fetch_prices()
                price_service._index_retry_after = now + MARKET_PRICE_MAX_AGE_SECONDS
                with price_service.lock:
                    index_items = payload.get('items', {}) or {}
                    for item_id in list(price_service._requested_item_ids):
                        quote_row = index_items.get(str(item_id)) or {}
                        if quote_row.get('resolved') is True:
                            price_service._requested_item_ids.discard(str(item_id))
                    remaining = bool(price_service._requested_item_ids)
                if not remaining:
                    payload = dict(payload)
                    payload['_refreshSucceeded'] = True
                    payload['_replaceCache'] = True
                    return payload
            except Exception as index_error:
                price_service._index_retry_after = now + 900
                if now - float(getattr(price_service, '_last_index_error_log', 0)) > 300:
                    price_service._last_index_error_log = now
                    self.thread_log(f'[市场报价] TBHIndex 暂不可用（{index_error}），切换 Steam 实时报价。')
        with price_service.lock:
            requested = sorted(price_service._requested_item_ids)
            merged = {key: dict(value) for key, value in price_service.cache.items()
                      if now - float(value.get('updatedAt') or 0) < MARKET_PRICE_MAX_AGE_SECONDS}
        if not requested:
            return {'source': 'steam-community-market', 'priceModel': price_service.MODEL,
                    'updatedAt': now, 'currency': 'CNY', 'itemCount': len(merged), 'items': merged,
                    'cnyPerUsd': 0, '_refreshSucceeded': False, '_replaceCache': False}
        try:
            quote = __import__('urllib.parse', fromlist=['quote']).quote
        except Exception:
            quote = lambda value, safe='': value.replace(' ', '%20')
        processed = set()
        steam_success_count = 0
        now = time.time()
        limited_retry_seconds = 900
        steam_retry_after = float(getattr(price_service, '_steam_retry_after', 0) or 0)
        if steam_retry_after > now:
            error_text = f'Steam Market 限流（HTTP 429），{int(steam_retry_after - now)} 秒后重试'
            for item_id in requested:
                if not ((merged.get(str(item_id)) or {}).get('resolved') is True and
                        float((merged.get(str(item_id)) or {}).get('priceCny') or 0) > 0):
                    merged[str(item_id)] = {'resolved': False, 'priceCny': 0,
                        'priceSource': 'steam-rate-limited', 'error': error_text,
                        'updatedAt': now, 'retryAfter': steam_retry_after}
                processed.add(str(item_id))
        for item_id in ([] if steam_retry_after > now else requested[:20]):
            names = market_names_for_item(item_id)
            if not names:
                merged[str(item_id)] = {'resolved': True, 'priceCny': 0, 'hasQuote': False,
                    'priceSource': 'not-marketable', 'updatedAt': now, 'retryAfter': now + MARKET_PRICE_MAX_AGE_SECONDS}
                processed.add(str(item_id))
                continue
            quote_row = None
            request_error = ''
            for market_name in names:
                address = ('https://steamcommunity.com/market/priceoverview/?appid=' + str(STEAM_APP_ID) +
                    '&currency=23&market_hash_name=' + quote(market_name, safe=''))
                try:
                    request = urllib.request.Request(address, headers={
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TBHHelper',
                        'Accept': 'application/json, text/plain, */*',
                        'Referer': 'https://steamcommunity.com/market/'
                    })
                    with urllib.request.urlopen(request, timeout=12) as response:
                        result = json.loads(response.read().decode('utf-8', errors='replace'))
                    if result.get('success') is True:
                        value = parse_market_price(result.get('lowest_sell_order') or result.get('lowest_price'))
                        if value is not None:
                            quote_row = {'resolved': True, 'priceCny': round(value, 2),
                                'marketName': market_name, 'priceSource': 'steam-community-market',
                                'rawPrice': value, 'rawCurrency': 'CNY', 'updatedAt': now,
                                'quoteUpdatedAt': result.get('last_updated') or ''}
                            break
                        quote_row = {'resolved': True, 'priceCny': 0, 'hasQuote': False,
                            'marketName': market_name, 'priceSource': 'steam-no-quote',
                            'updatedAt': now, 'retryAfter': now + MARKET_PRICE_MAX_AGE_SECONDS}
                        break
                    quote_row = {'resolved': True, 'priceCny': 0, 'hasQuote': False,
                        'marketName': market_name, 'priceSource': 'steam-no-quote',
                        'updatedAt': now, 'retryAfter': now + MARKET_PRICE_MAX_AGE_SECONDS}
                    break
                except Exception as exc:
                    request_error = str(exc)
                    if getattr(exc, 'code', None) == 429:
                        retry_header = ''
                        try:
                            retry_header = str(exc.headers.get('Retry-After') or '')
                        except Exception:
                            pass
                        try:
                            delay = max(60, min(3600, int(retry_header)))
                        except (TypeError, ValueError):
                            delay = limited_retry_seconds
                        retry_at = time.time() + delay
                        price_service._steam_retry_after = retry_at
                        request_error = f'Steam Market 限流（HTTP 429），{delay} 秒后重试'
                        if time.time() - float(getattr(price_service, '_last_steam_error_log', 0) or 0) > 300:
                            price_service._last_steam_error_log = time.time()
                            self.thread_log('[市场报价] Steam Market 返回 HTTP 429；已暂停批量请求并按 Retry-After 退避。')
                        for pending_id in requested:
                            if not ((merged.get(str(pending_id)) or {}).get('resolved') is True and
                                    float((merged.get(str(pending_id)) or {}).get('priceCny') or 0) > 0):
                                merged[str(pending_id)] = {'resolved': False, 'priceCny': 0,
                                    'priceSource': 'steam-rate-limited', 'error': request_error,
                                    'updatedAt': time.time(), 'retryAfter': retry_at}
                            processed.add(str(pending_id))
                        break
            if price_service._steam_retry_after > time.time():
                break
            if quote_row is None:
                quote_row = {'resolved': False, 'priceCny': 0, 'priceSource': 'steam-request-failed',
                    'updatedAt': now, 'retryAfter': now + 60, 'error': request_error[:160]}
            merged[str(item_id)] = quote_row
            processed.add(str(item_id))
            if quote_row.get('priceSource') in ('steam-community-market', 'steam-no-quote'):
                steam_success_count += 1
            time.sleep(1.5)
        with price_service.lock:
            price_service._requested_item_ids.difference_update(processed)
            more_pending = bool(price_service._requested_item_ids)
        payload = {'source': 'steam-community-market', 'priceModel': price_service.MODEL,
                   'updatedAt': 0 if more_pending else now, 'currency': 'CNY',
                   'itemCount': len(merged), 'items': merged, 'cnyPerUsd': 0,
                   '_refreshSucceeded': bool(steam_success_count > 0),
                   '_replaceCache': False}
        return payload

    price_service.request_items = request_prices_with_queue
    price_service._fetch_batch = fetch_prices_with_steam_fallback

    def run_market_price_service_hourly():
        import copy as _copy
        import os as _os
        load_price_cache_without_expiry()
        while not price_service.stop_event.is_set():
            now = time.time()
            manual = bool(getattr(price_service, '_manual_refresh_requested', False))
            with price_service.lock:
                enabled = bool(price_service.enabled)
                last_refresh = float(price_service.refresh_at or 0)
                retry_at = float(price_service.retry_at or 0)
            with price_service.lock:
                has_requested_items = bool(price_service._requested_item_ids)
            # Explicitly requested, uncached IDs need a fetch even when the
            # hourly catalog snapshot itself is still fresh.
            due = manual or has_requested_items or (enabled and (
                not last_refresh or now - last_refresh >= MARKET_PRICE_MAX_AGE_SECONDS))
            if due and now >= retry_at:
                price_service._manual_refresh_requested = False
                with price_service.lock:
                    attempted_ids = set(price_service._requested_item_ids)
                try:
                    fetched = price_service._fetch_batch()
                    if fetched.get('_refreshSucceeded') is not True:
                        raise RuntimeError('报价源未返回成功结果；已保留上次有效缓存')
                    fetched_items = fetched.get('items') or {}
                    if not isinstance(fetched_items, dict):
                        raise ValueError('报价回包的 items 字段无效')
                    replace_all = fetched.get('_replaceCache') is True
                    with price_service.lock:
                        if replace_all:
                            price_service.cache = _copy.deepcopy(fetched_items)
                        else:
                            for item_id, row in fetched_items.items():
                                if not isinstance(row, dict):
                                    continue
                                previous = price_service.cache.get(str(item_id)) or {}
                                if row.get('resolved') is True or row.get('error') or row.get('retryAfter'):
                                    if row.get('resolved') is True or previous.get('resolved') is not True:
                                        price_service.cache[str(item_id)] = _copy.deepcopy(row)
                        price_service.refresh_at = float(fetched.get('updatedAt') or time.time())
                        price_service.retry_at = 0
                        cached_items = _copy.deepcopy(price_service.cache)
                        pending_quotes = bool(price_service._requested_item_ids)
                    public_payload = {key: value for key, value in fetched.items()
                        if not str(key).startswith('_')}
                    public_payload.update(items=cached_items, itemCount=len(cached_items),
                        updatedAt=price_service.refresh_at, priceModel=price_service.MODEL,
                        replaceCache=True, cacheRefreshSucceeded=True)
                    try:
                        cache_path = price_service.cache_path
                        cache_path.parent.mkdir(parents=True, exist_ok=True)
                        temporary_path = cache_path.with_name(cache_path.name + '.tmp')
                        temporary_path.write_text(json.dumps(public_payload, ensure_ascii=False), encoding='utf-8')
                        _os.replace(str(temporary_path), str(cache_path))
                    except OSError as cache_error:
                        self.thread_log(f'[市场报价] 内存缓存已更新，磁盘缓存写入失败：{cache_error}')
                    payload_json = json.dumps(public_payload, ensure_ascii=False, separators=(',', ':'))
                    price_service.on_update(payload_json, public_payload)
                    self.thread_log(f'[市场报价] 价格缓存已更新：{len(cached_items)} 种；旧缓存已按本次成功结果替换/合并。')
                    if pending_quotes:
                        price_service._manual_refresh_requested = True
                except Exception as error:
                    failed_at = time.time()
                    failed_retry_at = failed_at + MARKET_PRICE_MAX_AGE_SECONDS
                    with price_service.lock:
                        price_service.retry_at = failed_retry_at
                        failed_ids = attempted_ids | set(price_service._requested_item_ids)
                        for item_id in failed_ids:
                            previous = price_service.cache.get(str(item_id)) or {}
                            if previous.get('resolved') is True:
                                continue
                            price_service.cache[str(item_id)] = {
                                'resolved': False, 'priceCny': 0,
                                'priceSource': 'query-failed', 'error': str(error)[:200],
                                'updatedAt': failed_at, 'retryAfter': failed_retry_at
                            }
                    if not getattr(self, 'shutting_down', False):
                        try:
                            self.after(0, render_warehouse)
                        except Exception:
                            pass
                    self.thread_log(f'[市场报价] 刷新失败，继续显示上次成功缓存；自动重试间隔 1 小时：{error}')
            price_service.wake_event.wait(2)
            price_service.wake_event.clear()

    price_service._run = run_market_price_service_hourly

    footer = ttk.Frame(self, style='Panel.TFrame', padding=(18, 5))
    footer.grid(row=1, column=0, columnspan=2, sticky='ew')
    footer.columnconfigure(0, weight=1)
    self.footer_status_var = tk.StringVar(value='就绪 · 等待启动')
    ttk.Label(footer, textvariable=self.footer_status_var, style='PanelMuted.TLabel').grid(row=0, column=0, sticky='w')
    footer_right = ttk.Frame(footer, style='Panel.TFrame')
    footer_right.grid(row=0, column=1, sticky='e')
    ttk.Label(footer_right, text='TBH助手 · v' + str(APP_VERSION) + '  by 阿丸AWan', style='PanelMuted.TLabel').pack(side='left')

    self._current_ui_page = None
    self._ui_select_page('overview')
    self.set_runtime_controls(False)
    self._ui_update_summaries()
    self.after(800, self.refresh_account_cards)
    self.after(1200, self._ui_refresh_summaries)
    self.after(1800, lambda: refresh_corrosion_status(True))

    def corrosion_status_heartbeat():
        if getattr(self, 'shutting_down', False):
            return
        refresh_corrosion_status(True)
        try:
            self.after(30000, corrosion_status_heartbeat)
        except Exception:
            pass

    self.after(3000, corrosion_status_heartbeat)

    # GitHub release polling. Only the public release metadata is read; the
    # user always confirms before any download or file replacement.
    def _version_tuple(value):
        import re
        raw = str(value or '').strip().lstrip('vV')
        parts = []
        for piece in re.split(r'[^0-9]+', raw):
            if not piece:
                continue
            try:
                parts.append(int(piece))
            except ValueError:
                pass
        while len(parts) > 1 and parts[-1] == 0:
            parts.pop()
        return tuple(parts)

    def set_auto_update_check(enabled):
        self.cfg['autoUpdateCheck'] = bool(enabled)
        try:
            save_config(self.cfg)
        except Exception as exc:
            self.thread_log(f'保存自动检测设置失败：{exc}')

    def check_github_update(manual=False):
        if getattr(self, 'shutting_down', False):
            return
        if getattr(self, '_github_update_busy', False):
            return
        if not manual and self.cfg.get('autoUpdateCheck', True) is False:
            return
        self._github_update_busy = True
        try:
            self.update_check_button.configure(state='disabled')
        except Exception:
            pass
        self.update_status_var.set('正在检测 GitHub 发布页…')

        def worker():
            release = None
            error = ''
            try:
                import urllib.request
                import xml.etree.ElementTree as ET
                import re
                # releases.atom is the public, unauthenticated feed. The REST
                # endpoint is limited to 60 requests/hour per IP and returns
                # 403 for users behind a shared address.
                request = urllib.request.Request(
                    'https://github.com/buguniaoOVO/TBHHelper/releases.atom',
                    headers={'User-Agent': 'TBHHelper', 'Accept': 'application/atom+xml'})
                with urllib.request.urlopen(request, timeout=15) as response:
                    content = response.read(1024 * 1024 + 1)
                    if len(content) > 1024 * 1024:
                        raise ValueError('发布页数据超过读取上限')
                    feed = ET.fromstring(content)
                namespace = {'atom': 'http://www.w3.org/2005/Atom'}
                for entry in feed.findall('atom:entry', namespace):
                    links = entry.findall('atom:link', namespace)
                    link = next((item for item in links if item.get('rel', 'alternate') == 'alternate'), None)
                    url = str(link.get('href') or '') if link is not None else ''
                    prefix = 'https://github.com/buguniaoOVO/TBHHelper/releases/tag/'
                    if not url.startswith(prefix):
                        continue
                    tag = url[len(prefix):]
                    if not re.fullmatch(r'v?[0-9]+(?:[.][0-9]+){1,3}', tag):
                        continue
                    body = entry.findtext('atom:content', default='', namespaces=namespace)
                    def unescape_html(value):
                        replacements = (('&lt;', '<'), ('&gt;', '>'), ('&quot;', '"'),
                                        ('&#39;', "'"), ('&amp;', '&'))
                        for source, target in replacements:
                            value = value.replace(source, target)
                        return value
                    release = {
                        'tag_name': tag,
                        'body': unescape_html(re.sub(r'<[^>]+>', '', body or '')).strip(),
                        'html_url': url
                    }
                    break
                if not release or not release.get('tag_name'):
                    raise ValueError('发布页没有可解析的版本')
            except Exception as exc:
                error = str(exc)

            def apply():
                self._github_update_busy = False
                if getattr(self, 'shutting_down', False):
                    return
                try:
                    self.update_check_button.configure(state='normal')
                except Exception:
                    pass
                if not manual and self.cfg.get('autoUpdateCheck', True) is False:
                    return
                if error or not isinstance(release, dict):
                    self.update_status_var.set('检测失败：' + (error or '发布页无有效返回')[:180])
                    if manual:
                        messagebox.showerror('检测更新', '无法读取 GitHub 发布页：' + error[:500], parent=self)
                    return
                tag = str(release.get('tag_name') or '').strip()
                if not tag:
                    self.update_status_var.set('检测失败：发布页没有版本号')
                    return
                latest = _version_tuple(tag)
                current = _version_tuple(APP_VERSION)
                body = str(release.get('body') or '').strip()
                if latest <= current:
                    text = (f'当前版本 v{APP_VERSION} 高于公开发布版本 {tag}' if latest < current else
                            f'已是最新版本 v{APP_VERSION}')
                    self.update_status_var.set(text)
                    if manual:
                        messagebox.showinfo('检测更新', text, parent=self)
                    return
                self.update_status_var.set(f'发现新版本 {tag}，当前 v{APP_VERSION}')
                notes = body[:700] if body else '（发布页未提供更新公告）'
                answer = messagebox.askyesno('发现新版本 ' + tag,
                    f'当前版本：v{APP_VERSION}\n最新版本：{tag}\n\n更新公告：\n{notes}\n\n是否打开发布页下载？',
                    parent=self)
                if answer:
                    self._open_external_link(str(release.get('html_url') or
                        'https://github.com/buguniaoOVO/TBHHelper/releases/latest'))

            try:
                self.after(0, apply)
            except Exception:
                self._github_update_busy = False

        threading.Thread(target=worker, name='GitHub版本检测', daemon=True).start()

    self.check_github_update = check_github_update
    self.set_auto_update_check = set_auto_update_check
    self.after(3000, lambda: self.check_github_update(manual=False))
    def schedule_next_update_check():
        if getattr(self, 'shutting_down', False):
            return
        if self.cfg.get('autoUpdateCheck', True) is not False:
            self.check_github_update(manual=False)
        try:
            self.after(12 * 60 * 60 * 1000, schedule_next_update_check)
        except Exception:
            pass

    self.after(12 * 60 * 60 * 1000, schedule_next_update_check)

    def open_external_link(url):
        try:
            os.startfile(url)
        except Exception as exc:
            messagebox.showerror('打开链接失败', f'{exc}\n\n{url}', parent=self)

    self._open_external_link = open_external_link

    # Keep callbacks and feature controls accessible to existing controller methods.
    self._dashboard_sections.extend((header, self.page_host))

    # Window size changes reflow the current page. Font sizes stay at the
    # Windows DPI scale, avoiding a full Ttk font/layout rebuild while dragging.
    self.resizable(True, True)
    self._ui_responsive_header_mode = None

    def apply_responsive_layout(_override=None):
        self._ui_resize_after_id = None
        if getattr(self, 'shutting_down', False):
            return
        self._ui_scale = 1.0
        width = self.winfo_width()
        mode = 'wide' if width >= 1400 else 'compact' if width >= 1150 else 'narrow'
        if mode != self._ui_responsive_header_mode:
            self._ui_responsive_header_mode = mode
            top_tools.grid_configure(row=0 if mode == 'wide' else 1,
                column=1 if mode == 'wide' else 0, columnspan=1 if mode == 'wide' else 2,
                rowspan=1, sticky='e' if mode == 'wide' else 'w',
                padx=(14, 0) if mode == 'wide' else (0, 0), pady=(0, 0) if mode == 'wide' else (8, 0))
            for index, widget in enumerate((self.stop_all_button, self.hide_game_button, self.exit_button)):
                widget.grid_configure(row=1 if mode == 'narrow' else 0,
                    column=index if mode == 'narrow' else index + 3)
        if getattr(self, '_current_ui_page', None) == 'warehouse':
            schedule_warehouse_card_draw()

    def on_responsive_resize(event):
        if event.widget is not self or getattr(self, 'shutting_down', False):
            return
        if self._ui_resize_after_id is not None:
            self.after_cancel(self._ui_resize_after_id)
        self._ui_resize_after_id = self.after(80, apply_responsive_layout)

    self._capture_scalable_widgets = lambda: setattr(self, '_ui_widget_metrics', [])
    self._apply_dashboard_scale = apply_responsive_layout
    self._on_dashboard_resize = on_responsive_resize
    self.after_idle(apply_responsive_layout)

    # Internal UI callbacks are attached as bound methods so the rest of the
    # existing controller remains byte-for-byte unchanged.
    self.__dict__['_ui_select_page_callback'] = self._ui_select_page
    original_close = self.on_close

    def close_and_restore_windows():
        for pid in list(self._ui_hidden_game_windows):
            try:
                set_process_windows(pid, False, closing=True)
            except Exception as exc:
                self.thread_log(f'[进程 {pid}] 退出时恢复窗口失败：{exc}')
        original_close()

    def close_to_tray():
        if getattr(self, 'shutting_down', False):
            return
        self.tray_pending_hide = True
        try:
            if self.tray is None:
                self.tray = WorkbenchTray(self.tray_actions, BUNDLE_DIR / 'app_icon.ico')
            if self.tray_ready:
                self._hide_to_tray()
            else:
                def check_tray_ready():
                    if getattr(self, 'shutting_down', False) or not self.tray_pending_hide:
                        return
                    if not self.tray_ready:
                        self.tray_pending_hide = False
                        self.deiconify()
                        self.thread_log('[托盘] 初始化尚未完成，已保留主窗口。')
                self.after(5000, check_tray_ready)
        except Exception as exc:
            self.tray_pending_hide = False
            self.tray = None
            self.tray_ready = False
            self.deiconify()
            self.thread_log(f'[托盘] 初始化失败，主窗口已保留：{exc}')

    self.on_close = close_and_restore_windows
    self._ui_close_to_tray = close_to_tray
    # main() sets its protocol after building the UI; install this on the next Tk turn.
    self.after_idle(lambda: self.protocol('WM_DELETE_WINDOW', close_to_tray))
    self.exit_button.configure(command=self.on_close)
    self.auto_start_button.configure(command=start_automation)
