/** ABI-stable N-API wrapper around in-process ScreenCaptureKit overlay-exclude capture. */

#include <node_api.h>
#include <stdlib.h>
#include <string.h>

extern int dsh_macos_sck_capture(
    const char *region,
    const char *exclude,
    const char *output,
    char *error_buffer,
    int error_length);

typedef struct {
  char *region;
  char *exclude;
  char *output;
  char error[4096];
  int status;
  napi_deferred deferred;
  napi_async_work work;
} CaptureWork;

static void execute_capture(napi_env env, void *data) {
  (void)env;
  CaptureWork *work = data;
  work->status = dsh_macos_sck_capture(
      work->region,
      work->exclude,
      work->output,
      work->error,
      (int)sizeof(work->error));
}

static void complete_capture(napi_env env, napi_status status, void *data) {
  CaptureWork *work = data;
  if (status != napi_ok || work->status != 0) {
    const char *text = status != napi_ok
        ? "dsh desktop: overlay-exclude capture worker failed"
        : (work->error[0] != '\0' ? work->error : "dsh desktop: overlay-exclude capture failed");
    napi_value message;
    napi_value error;
    napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &message);
    napi_create_error(env, NULL, message, &error);
    napi_reject_deferred(env, work->deferred, error);
  } else {
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    napi_resolve_deferred(env, work->deferred, undefined);
  }
  napi_delete_async_work(env, work->work);
  free(work->region);
  free(work->exclude);
  free(work->output);
  free(work);
}

static char *dup_utf8(napi_env env, napi_value value) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok) {
    return NULL;
  }
  char *buffer = malloc(length + 1);
  if (buffer == NULL) {
    return NULL;
  }
  if (napi_get_value_string_utf8(env, value, buffer, length + 1, &length) != napi_ok) {
    free(buffer);
    return NULL;
  }
  return buffer;
}

static void free_work(CaptureWork *work) {
  free(work->region);
  free(work->exclude);
  free(work->output);
  free(work);
}

static napi_value capture(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_value promise;
  napi_deferred deferred;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 3) {
    napi_throw_error(env, NULL, "dsh desktop: overlay-exclude capture expects region, exclude, and output");
    return NULL;
  }
  if (napi_create_promise(env, &deferred, &promise) != napi_ok) {
    return NULL;
  }
  CaptureWork *work = calloc(1, sizeof(*work));
  if (work == NULL) {
    napi_throw_error(env, NULL, "dsh desktop: overlay-exclude capture allocation failed");
    return NULL;
  }
  work->deferred = deferred;
  work->region = dup_utf8(env, argv[0]);
  work->exclude = dup_utf8(env, argv[1]);
  work->output = dup_utf8(env, argv[2]);
  if (work->region == NULL || work->exclude == NULL || work->output == NULL) {
    free_work(work);
    napi_throw_error(env, NULL, "dsh desktop: overlay-exclude capture arguments are not strings");
    return NULL;
  }
  napi_value name;
  napi_create_string_utf8(env, "dsh-macos-sck-capture", NAPI_AUTO_LENGTH, &name);
  if (napi_create_async_work(env, NULL, name, execute_capture, complete_capture, work, &work->work) != napi_ok
      || napi_queue_async_work(env, work->work) != napi_ok) {
    free_work(work);
    napi_throw_error(env, NULL, "dsh desktop: overlay-exclude capture could not queue work");
    return NULL;
  }
  return promise;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "capture", NAPI_AUTO_LENGTH, capture, NULL, &fn);
  napi_set_named_property(env, exports, "capture", fn);
  return exports;
}
