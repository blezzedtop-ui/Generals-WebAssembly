/*
**	Command & Conquer Generals Zero Hour(tm)
**	Copyright 2025 Electronic Arts Inc.
**
**	This program is free software: you can redistribute it and/or modify
**	it under the terms of the GNU General Public License as published by
**	the Free Software Foundation, either version 3 of the License, or
**	(at your option) any later version.
**
**	This program is distributed in the hope that it will be useful,
**	but WITHOUT ANY WARRANTY; without even the implied warranty of
**	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
**	GNU General Public License for more details.
**
**	You should have received a copy of the GNU General Public License
**	along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

/*
** WebMain.cpp
**
** Entry point for the Emscripten (WebAssembly) build.
**
** GeneralsX @build web-port 05/07/2026 - Web port Phase 0
** Follows SDL3Main.cpp (the Linux/macOS/iOS entry point) with the platform
** bootstrap swapped for the browser environment:
**  - No Vulkan/DXVK: rendering goes through the statically linked d3d8webgl
**    library (D3D8 -> WebGL2), created by DX8Wrapper::Init() directly.
**  - Game data lives in OPFS (Origin Private File System). The JS loader
**    downloads the .big set into OPFS before starting the wasm module; here
**    we mount that OPFS root at /opfs via WASMFS and point the engine's
**    asset/user-data resolution at it with two environment variables
**    (StdBIGFileSystem reads CNC_GENERALS_ZH_PATH, GlobalData reads
**    XDG_DATA_HOME) - no file-system code changes needed.
**  - main() runs on a dedicated pthread (-sPROXY_TO_PTHREAD), so the engine's
**    blocking GameEngine::execute() loop and synchronous fread() over OPFS
**    access handles are both legal here.
*/

			// GeneralsX @bugfix OpenAI 01/10/2026 Keep SDL and d3d8webgl on the same wide render mode.
			SDL_SetWindowSize(TheSDL3Window, webRenderW, webRenderH);
			d3d8webgl_set_native_mode(webRenderW, webRenderH);

		}

		// FFmpeg: errors only (16 = AV_LOG_ERROR). Some video paths create
		// swscale contexts before FFmpegFile::open() runs, so set it here.
		av_log_set_level(16);



		// Loader FPS setting (Module.gxFps): enforced each frame in
		// gxWebPeriodic() through FramePacer's render/logic decoupling.
		s_gxFpsSetting = MAIN_THREAD_EM_ASM_INT({
			return (typeof Module !== 'undefined' && Module.gxFps) ? (Module.gxFps | 0) : 0;
		});
		if (s_gxFpsSetting > 30) {
			fprintf(stderr, "INFO: render FPS setting: %d (logic stays at the game-speed value)\n", s_gxFpsSetting);
		}

		// Call cross-platform game entry point
		exitcode = GameMain();

		// GeneralsX @build web-port 05/07/2026 - Web port Phase 2
		// GameMain() returned with the rAF main loop registered and the
		// engine still alive (see GameEngine::execute web branch). Keep the
		// wasm runtime (and this pthread) alive; NONE of the teardown below
		// may run. Quit terminates from inside the loop tick (_exit).
		fprintf(stderr, "INFO: main loop armed; keeping runtime alive\n");
		emscripten_exit_with_live_runtime();

		fprintf(stderr, "INFO: GameMain() returned with code %d\n", exitcode);

	} catch (const std::exception& e) {
		fprintf(stderr, "FATAL: Unhandled exception in main(): %s\n", e.what());
		exitcode = 1;
	} catch (...) {
		fprintf(stderr, "FATAL: Unknown exception in main()\n");
		exitcode = 1;
	}

	// Cleanup SDL3 resources
	if (TheSDL3Window) {
		SDL_DestroyWindow(TheSDL3Window);
		TheSDL3Window = nullptr;
		ApplicationHWnd = nullptr;
	}
	SDL_Quit();

	if (TheVersion) {
		delete TheVersion;
		TheVersion = nullptr;
	}

	// Same shutdown order as SDL3Main.cpp: memory manager before critSec nulling.
	shutdownMemoryManager();

	TheAsciiStringCriticalSection = nullptr;
	TheUnicodeStringCriticalSection = nullptr;
	TheDmaCriticalSection = nullptr;
	TheMemoryPoolCriticalSection = nullptr;
	TheDebugLogCriticalSection = nullptr;

	fprintf(stderr, "\nExiting with code %d\n", exitcode);

	// Skip C++ global destructors (see SDL3Main.cpp rationale: pool dtors
	// crash after game shutdown reused their memory). Terminates the wasm
	// runtime; the page-side JS shows a "game exited" panel.
	_exit(exitcode);
}

#endif // __EMSCRIPTEN__
