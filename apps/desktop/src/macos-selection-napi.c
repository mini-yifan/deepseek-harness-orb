/** ABI-stable N-API wrapper around in-process Darwin selection monitoring. */

#include <node_api.h>
#include <stdlib.h>
#include <string.h>

typedef void (*dsh_selection_emit)(const char *line, void *ctx);

extern int dsh_macos_selection_start(dsh_selection_emit emit, void *ctx);
extern void dsh_macos_selection_stop(void);
extern void dsh_macos_selection_exclude_pids(const char *pids);
extern void dsh_macos_selection_activate_pid(int pid);

static napi_threadsafe_function tsfn;

static void call_js(napi_env env, napi_value js_cb, void *context, void *data) {
  (void)context;
  char *line = data;
  if (env == NULL || js_cb == NULL) {
    free(line);
    return;
  }
  napi_value str;
  napi_value undefined;
  napi_value result;
  if (napi_create_string_utf8(env, line, NAPI_AUTO_LENGTH, &str) != napi_ok) {
    free(line);
    return;
  }
  napi_get_undefined(env, &undefined);
  napi_call_function(env, undefined, js_cb, 1, &str, &result);
  free(line);
}

static void emit_line(const char *line, void *ctx) {
  (void)ctx;
  if (tsfn == NULL || line == NULL) return;
  char *copy = strdup(line);
  if (copy == NULL) return;
  if (napi_call_threadsafe_function(tsfn, copy, napi_tsfn_nonblocking) != napi_ok) {
    free(copy);
  }
}

static void release_tsfn(void) {
  if (tsfn == NULL) return;
  napi_release_threadsafe_function(tsfn, napi_tsfn_release);
  tsfn = NULL;
}

static napi_value start(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_valuetype type;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 1) {
    napi_throw_error(env, NULL, "dsh desktop: selection start expects a callback");
    return NULL;
  }
  if (napi_typeof(env, argv[0], &type) != napi_ok || type != napi_function) {
    napi_throw_error(env, NULL, "dsh desktop: selection start callback must be a function");
    return NULL;
  }
  dsh_macos_selection_stop();
  release_tsfn();
  napi_value name;
  napi_create_string_utf8(env, "dsh-macos-selection", NAPI_AUTO_LENGTH, &name);
  if (napi_create_threadsafe_function(
        env, argv[0], NULL, name, 16, 1, NULL, NULL, NULL, call_js, &tsfn)
      != napi_ok) {
    napi_throw_error(env, NULL, "dsh desktop: selection start could not create threadsafe callback");
    return NULL;
  }
  if (dsh_macos_selection_start(emit_line, NULL) != 0) {
    release_tsfn();
    napi_throw_error(env, NULL, "dsh desktop: selection start failed");
    return NULL;
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

static napi_value stop(napi_env env, napi_callback_info info) {
  (void)info;
  dsh_macos_selection_stop();
  release_tsfn();
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

static napi_value exclude_pids(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  size_t length = 0;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 1) {
    napi_throw_error(env, NULL, "dsh desktop: selection excludePids expects a string");
    return NULL;
  }
  if (napi_get_value_string_utf8(env, argv[0], NULL, 0, &length) != napi_ok) {
    napi_throw_error(env, NULL, "dsh desktop: selection excludePids expects a string");
    return NULL;
  }
  char *pids = malloc(length + 1);
  if (pids == NULL) {
    napi_throw_error(env, NULL, "dsh desktop: selection excludePids allocation failed");
    return NULL;
  }
  if (napi_get_value_string_utf8(env, argv[0], pids, length + 1, &length) != napi_ok) {
    free(pids);
    napi_throw_error(env, NULL, "dsh desktop: selection excludePids expects a string");
    return NULL;
  }
  dsh_macos_selection_exclude_pids(pids);
  free(pids);
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

static napi_value activate_pid(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  int32_t pid = 0;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 1) {
    napi_throw_error(env, NULL, "dsh desktop: selection activatePid expects a pid");
    return NULL;
  }
  if (napi_get_value_int32(env, argv[0], &pid) != napi_ok) {
    napi_throw_error(env, NULL, "dsh desktop: selection activatePid expects a pid");
    return NULL;
  }
  dsh_macos_selection_activate_pid(pid);
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

NAPI_MODULE_INIT() {
  napi_value start_fn;
  napi_value stop_fn;
  napi_value exclude_fn;
  napi_value activate_fn;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, start, NULL, &start_fn);
  napi_create_function(env, "stop", NAPI_AUTO_LENGTH, stop, NULL, &stop_fn);
  napi_create_function(env, "excludePids", NAPI_AUTO_LENGTH, exclude_pids, NULL, &exclude_fn);
  napi_create_function(env, "activatePid", NAPI_AUTO_LENGTH, activate_pid, NULL, &activate_fn);
  napi_set_named_property(env, exports, "start", start_fn);
  napi_set_named_property(env, exports, "stop", stop_fn);
  napi_set_named_property(env, exports, "excludePids", exclude_fn);
  napi_set_named_property(env, exports, "activatePid", activate_fn);
  return exports;
}
