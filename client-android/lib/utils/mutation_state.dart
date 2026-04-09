import 'package:aetherproxy/core/model/failures.dart';
import 'package:freezed_annotation/freezed_annotation.dart';

part 'mutation_state.freezed.dart';

class MutationState<F extends Failure> with _$MutationState<F> {
  const MutationState._();

  const factory MutationState.initial() = MutationInitial<F>;
  const factory MutationState.inProgress() = MutationInProgress<F>;
  const factory MutationState.failure(Failure failure) = MutationFailure<F>;
  const factory MutationState.success() = MutationSuccess<F>;

  bool get isInProgress => this is MutationInProgress;
}
