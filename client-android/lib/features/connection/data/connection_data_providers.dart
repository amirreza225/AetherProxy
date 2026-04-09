import 'package:aetherproxy/core/directories/directories_provider.dart';
import 'package:aetherproxy/features/connection/data/connection_repository.dart';
import 'package:aetherproxy/features/profile/data/profile_data_providers.dart';
import 'package:aetherproxy/features/settings/data/config_option_data_providers.dart';
import 'package:aetherproxy/hiddifycore/hiddify_core_service_provider.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'connection_data_providers.g.dart';

ConnectionRepository connectionRepository(Ref ref) {
  return ConnectionRepositoryImpl(
    ref: ref,
    directories: ref.watch(appDirectoriesProvider).requireValue,
    configOptionRepository: ref.watch(configOptionRepositoryProvider),
    singbox: ref.watch(hiddifyCoreServiceProvider),
    profilePathResolver: ref.watch(profilePathResolverProvider),
  );
}
