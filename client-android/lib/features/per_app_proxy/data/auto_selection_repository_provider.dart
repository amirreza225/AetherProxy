import 'package:aetherproxy/features/per_app_proxy/data/auto_selection_repository.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'auto_selection_repository_provider.g.dart';

@Riverpod(keepAlive: true)
AutoSelectionRepository autoSelectionRepo(Ref ref) => AutoSelectionRepositoryImpl(ref: ref);
