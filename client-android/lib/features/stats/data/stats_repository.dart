import 'package:aetherproxy/core/utils/exception_handler.dart';
import 'package:aetherproxy/features/stats/model/stats_failure.dart';
import 'package:aetherproxy/hiddifycore/generated/v2/hcore/hcore.pb.dart';
import 'package:aetherproxy/hiddifycore/hiddify_core_service.dart';
import 'package:aetherproxy/utils/custom_loggers.dart';
import 'package:fpdart/fpdart.dart';

abstract interface class StatsRepository {
  Stream<Either<StatsFailure, SystemInfo>> watchStats();
}

class StatsRepositoryImpl with ExceptionHandler, InfraLogger implements StatsRepository {
  StatsRepositoryImpl({required this.singbox});

  final HiddifyCoreService singbox;

  @override
  Stream<Either<StatsFailure, SystemInfo>> watchStats() {
    return singbox.watchStats().handleExceptions(StatsUnexpectedFailure.new);
  }
}
