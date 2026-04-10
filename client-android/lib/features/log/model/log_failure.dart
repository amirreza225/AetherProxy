import 'package:aetherproxy/core/localization/translations.dart';
import 'package:aetherproxy/core/model/failures.dart';
import 'package:freezed_annotation/freezed_annotation.dart';

part 'log_failure.freezed.dart';

@freezed
sealed class LogFailure with _$LogFailure, Failure {
  const LogFailure._();

  @With<UnexpectedFailure>()
  const factory LogFailure.unexpected([Object? error, StackTrace? stackTrace]) = LogUnexpectedFailure;

  @override
  ({String type, String? message}) present(TranslationsEn t) {
    return switch (this) {
      LogUnexpectedFailure() => (type: t.errors.unexpected, message: null),
    };
  }
}
