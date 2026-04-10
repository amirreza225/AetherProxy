import 'package:aetherproxy/core/http_client/http_client_provider.dart';
import 'package:aetherproxy/features/app_update/data/app_update_repository.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'app_update_data_providers.g.dart';

@Riverpod(keepAlive: true)
AppUpdateRepository appUpdateRepository(Ref ref) {
  return AppUpdateRepositoryImpl(httpClient: ref.watch(httpClientProvider));
}
