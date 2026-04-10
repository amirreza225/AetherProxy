import 'package:aetherproxy/features/app_update/model/app_update_failure.dart';
import 'package:aetherproxy/features/app_update/model/remote_version_entity.dart';
import 'package:freezed_annotation/freezed_annotation.dart';

part 'app_update_state.freezed.dart';

@freezed
class AppUpdateState with _$AppUpdateState {
  const factory AppUpdateState.initial() = AppUpdateStateInitial;
  const factory AppUpdateState.disabled() = AppUpdateStateDisabled;
  const factory AppUpdateState.checking() = AppUpdateStateChecking;
  const factory AppUpdateState.error(AppUpdateFailure error) = AppUpdateStateError;
  const factory AppUpdateState.available(RemoteVersionEntity versionInfo) = AppUpdateStateAvailable;
  const factory AppUpdateState.ignored(RemoteVersionEntity versionInfo) = AppUpdateStateIgnored;
  const factory AppUpdateState.notAvailable() = AppUpdateStateNotAvailable;
}
