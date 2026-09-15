const std = @import("std");
const runner = @import("runner");
const native_sdk = @import("native_sdk");

pub const panic = std.debug.FullPanic(native_sdk.debug.capturePanic);

const App = struct {
    fn app(self: *@This()) native_sdk.App {
        return .{
            .context = self,
            .name ="keco-studio",
            .source_fn = source,
        };
    }

    fn source(_: *anyopaque) anyerror!native_sdk.WebViewSource {
        return native_sdk.WebViewSource.url("https://keco-studio-main.vercel.app/projects?desktop=1");
    }
};

const allowed_origins = [_][]const u8{ "https://keco-studio-main.vercel.app" };

pub fn main(init: std.process.Init) !void {
    var app = App{};
    try runner.runWithOptions(app.app(), .{
        .app_name ="Keco Studio",
        .window_title ="Keco Studio",
        .bundle_id ="dev.keco.studio",
        .icon_path = "assets/icon.png",
        .security = .{
            .navigation = .{ .allowed_origins = &allowed_origins },
        },
    }, init);
}

test "app name is configured" {
    try std.testing.expectEqualStrings("keco-studio","keco-studio");
}
