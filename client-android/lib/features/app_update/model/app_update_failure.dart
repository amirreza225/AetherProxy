import 'package:aetherproxy/core/localization/translations.dart';
import 'package:aetherproxy/core/model/failures.dart';
import 'package:freezed_annotation/freezed_annotation.dart';

part 'app_update_failure.freezed.dart';

sealed class AppUpdateFailure with _$AppUpdateFailure, Failure {
  const AppUpdateFailure._();

  @With<UnexpectedFailure>()
  const factory AppUpdateFailure.unexpected([Object? error, StackTrace? stackTrace]) = AppUpdateUnexpectedFailure;

  @override
  ({String type, String? message}) present(TranslationsEn t) {
    return switch (this) {
      AppUpdateUnexpectedFailure() => (type: t.errors.unexpected, message: null),
    };
  }
}
